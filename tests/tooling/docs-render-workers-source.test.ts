import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from "node:fs/promises";
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
      await write(file, Buffer.concat([original, Buffer.from("complete authored build output\n")]));
    }
    const two = await workersGeneratedIdentity(root, source, before);
    assert.deepEqual(
      two.generated.map(({ file }) => file),
      generatedWorkersFiles,
    );
    assert(two.generated.every(({ before: old, after }) => old.sha256 !== after.sha256));
    assert.equal(two.producerFiles.length, 7);
    await retainWorkersGeneratedBytes(root, output, "outputs");
    await verifyWorkersGeneratedBytes(output, two.generated);
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
    const unknown = "docs/public/component-previews/unknown.png";
    await write(unknown, "untracked adjacent output");
    await assert.rejects(() => workersGeneratedIdentity(root, source, before), /staged\/untracked/);
    await rm(path.join(root, unknown));
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
