import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  generatedWorkersFiles,
  workersCheckoutIdentity,
  workersGeneratedIdentity,
  retainWorkersGeneratedBytes,
  verifyWorkersGeneratedBytes,
} from "../../docs/scripts/navigation-render-workers-custody.ts";
import { retainWorkersGitObservation } from "../../docs/scripts/navigation-render-workers-git-observation.ts";

void test("actual clean Git checkout, nine generated outputs and both arm custody remain complete", async () => {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "vize-workers-source-")));
  const root = path.join(temporary, "checkout");
  const output = path.join(temporary, "evidence");
  await mkdir(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = async (file: string, bytes: string | Buffer) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), bytes);
  };
  try {
    git("init", "--quiet");
    git("config", "user.name", "Authored custody fixture");
    git("config", "user.email", "custody@example.invalid");
    for (const file of generatedWorkersFiles) await write(file, `original whole ${file}\n`);
    for (const file of [
      "docs/package.json",
      "docs/scripts/build-ui-previews.ts",
      "docs/previews/ui/capture.ts",
      "npm/ui/scripts/reference-docs/examples.ts",
      "npm/native/package.json",
      "npm/native/scripts/sync-entrypoint.mjs",
      "crates/vize_vitrine/Cargo.toml",
      "docs/scripts/unchanged.ts",
      "docs/public/component-previews/nearby.png",
      "assets/logo.svg",
      "assets/logo-light.svg",
    ])
      await write(file, `unchanged whole source ${file}\n`);
    for (const name of ["logo.svg", "logo-light.svg"])
      await symlink(`../../assets/${name}`, path.join(root, "docs/public", name));
    git("add", ".");
    git("commit", "--quiet", "-m", "test: author complete checkout");
    const gitlink = "tests/_fixtures/_git/authored";
    await mkdir(path.join(root, gitlink), { recursive: true });
    git("update-index", "--add", "--cacheinfo", `160000,${git("rev-parse", "HEAD")},${gitlink}`);
    git("commit", "--quiet", "-m", "test: pin original empty gitlink");
    const source = git("rev-parse", "HEAD");
    const before = await workersCheckoutIdentity(root, source);
    assert.equal(before.gitlinks.length, 1);
    assert.equal(before.sourceFiles.filter(({ link }) => link).length, 2);
    await retainWorkersGeneratedBytes(root, output, "inputs");
    for (const file of generatedWorkersFiles) {
      const original = await readFile(path.join(root, file));
      const bytes = Buffer.concat([original, Buffer.from("complete authored build output\n")]);
      await write(file, bytes);
      if (file.endsWith(".png"))
        await write(
          file.replace(/\.png$/, `-${createHash("sha256").update(bytes).digest("hex")}.png`),
          bytes,
        );
    }
    await retainWorkersGeneratedBytes(root, output, "outputs");
    const two = await workersGeneratedIdentity(root, source, before);
    assert.deepEqual(
      two.generated.map(({ file }) => file),
      generatedWorkersFiles,
    );
    assert(two.generated.every(({ before: old, after }) => old.sha256 !== after.sha256));
    assert.equal(two.producerFiles.length, 7);
    assert.equal(two.publicGenerated.length, 8);
    for (const image of two.publicGenerated) {
      assert.equal(image.mode, "100644");
      assert.equal(image.physicalMode, 0o644);
      assert(image.file.endsWith(`-${image.sha256}.png`));
      const original = await readFile(path.join(root, image.file));
      await write(image.file, "wrong immutable PNG body");
      await assert.rejects(
        () => workersGeneratedIdentity(root, source, before),
        /strictly equal|logical generated body/,
      );
      await write(image.file, original);
    }
    const immutable = path.join(root, two.publicGenerated[0].file);
    for (const physicalMode of [0o755, 0o600, 0o666]) {
      await chmod(immutable, physicalMode);
      await assert.rejects(
        () => workersGeneratedIdentity(root, source, before),
        /generated PNG mode/,
      );
    }
    await chmod(immutable, 0o644);
    const immutableBytes = await readFile(immutable);
    await rm(immutable);
    await symlink(path.join(root, two.publicGenerated[0].logical), immutable);
    await assert.rejects(
      () => workersGeneratedIdentity(root, source, before),
      /Physical content-addressed/,
    );
    await rm(immutable);
    await writeFile(immutable, immutableBytes);
    const nearbyHash = `docs/public/component-previews/alert-${"f".repeat(64)}.png`;
    await write(nearbyHash, immutableBytes);
    await assert.rejects(() => workersGeneratedIdentity(root, source, before), /staged\/untracked/);
    await rm(path.join(root, nearbyHash));
    git("add", two.publicGenerated[0].file);
    await assert.rejects(() => workersGeneratedIdentity(root, source, before), /staged\/untracked/);
    git("reset", "--quiet", "HEAD", "--", two.publicGenerated[0].file); // Owned temporary authored fixture only.
    await verifyWorkersGeneratedBytes(output, two.generated);
    const replacement = path.join(temporary, "replacement.bin");
    await writeFile(replacement, "opaque Git replacement must not supply original producer bytes");
    const oldObject = before.sourceFiles.find(
      ({ file }) => file === generatedWorkersFiles[0],
    )!.object;
    git("replace", oldObject, git("hash-object", "-w", replacement));
    assert.deepEqual(
      await workersGeneratedIdentity(root, source, before),
      two,
      "Original physical Git objects ignore replacements",
    );
    git("replace", "--delete", oldObject);
    const four = await workersGeneratedIdentity(root, source, before);
    assert.deepEqual(two, four, "Both arms use every identical source/build output");
    await assert.rejects(
      () => workersCheckoutIdentity(root, source),
      /generated output census/,
      "Generated checkout cannot impersonate the original clean source",
    );

    for (const file of [
      "docs/scripts/unchanged.ts",
      "docs/public/component-previews/nearby.png",
      "assets/logo.svg",
    ]) {
      const original = await readFile(path.join(root, file));
      await write(file, "changed unknown source");
      await assert.rejects(
        () => workersGeneratedIdentity(root, source, before),
        /generated output census/,
      );
      await write(file, original);
    }
    const unknown = "docs/public/component-previews/unknown\nwith-tab\t.png";
    await write(unknown, "untracked adjacent output");
    const observation = await retainWorkersGitObservation(root, output, source, "prepare");
    assert.equal(observation.source, source);
    assert.equal(observation.tree, before.tree);
    const rawStatus = await readFile(path.join(output, "git-prepare/status.z"));
    assert.deepEqual(
      rawStatus,
      execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root }),
    );
    assert(rawStatus.includes(Buffer.from(`?? ${unknown}\0`)));
    const rawIndex = await readFile(path.join(output, "git-prepare/index.z"));
    assert.deepEqual(rawIndex, execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: root }));
    assert.deepEqual(
      await readFile(path.join(output, "git-prepare/source-paths.z")),
      execFileSync("git", ["ls-files", "-z"], { cwd: root }),
    );
    await assert.rejects(
      () => workersGeneratedIdentity(root, source, before),
      (error: unknown) =>
        error instanceof Error && error.message.includes(JSON.stringify(`?? ${unknown}`)),
    );
    await verifyWorkersGeneratedBytes(output, two.generated);
    await assert.rejects(
      () => retainWorkersGitObservation(root, output, source, "prepare"),
      /EEXIST/,
    );
    await rm(path.join(root, unknown));
    const generated = path.join(root, generatedWorkersFiles[0]);
    const generatedBytes = await readFile(generated);
    await rm(generated);
    await symlink(path.join(root, "assets/logo.svg"), generated);
    await assert.rejects(
      () => retainWorkersGeneratedBytes(root, path.join(temporary, "substituted"), "outputs"),
      /Physical generated file/,
    );
    await rm(generated);
    await writeFile(generated, generatedBytes);
    git("add", generatedWorkersFiles[0]);
    await assert.rejects(() => workersGeneratedIdentity(root, source, before), /staged\/untracked/);
    git("reset", "--quiet", "HEAD", "--", generatedWorkersFiles[0]); // Owned temporary authored fixture only.
    const logo = path.join(root, "docs/public/logo.svg");
    await rm(logo);
    await symlink("../../assets/logo-light.svg", logo);
    await assert.rejects(
      () => workersGeneratedIdentity(root, source, before),
      /generated output census/,
    );
    await rm(logo);
    await symlink("../../assets/logo.svg", logo);
    await write(`${gitlink}/unknown-source.ts`, "new populated fixture input");
    await assert.rejects(() => workersGeneratedIdentity(root, source, before), /gitlinks/);
    await rm(path.join(root, gitlink, "unknown-source.ts"));
    const raw = path.join(output, "build-inputs", generatedWorkersFiles[0]);
    const original = await readFile(raw);
    await writeFile(raw, "substituted original bytes");
    await assert.rejects(
      () => verifyWorkersGeneratedBytes(output, two.generated),
      /original|strictly equal/,
    );
    await writeFile(raw, original);
    await verifyWorkersGeneratedBytes(output, two.generated);
    assert.deepEqual(
      await workersGeneratedIdentity(root, source, before),
      two,
      "Complete original positive custody survives every refusal control",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
