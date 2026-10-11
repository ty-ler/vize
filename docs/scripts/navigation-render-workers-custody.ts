import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, readFile, readlink, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { resolvePuppeteerExecutablePath } from "../browser-path.js";

export async function fileCustody(file: string, expectedBlob?: string) {
  const physical = await realpath(file);
  const stat = await lstat(physical);
  assert(stat.isFile(), `Expected physical file: ${file}`);
  const digest = createHash("sha256");
  const blob = createHash("sha1").update(`blob ${stat.size}\0`);
  for await (const bytes of createReadStream(physical)) {
    digest.update(bytes);
    blob.update(bytes);
  }
  if (expectedBlob)
    assert.equal(blob.digest("hex"), expectedBlob, `Tracked Git blob changed: ${file}`);
  return { file, physical, bytes: stat.size, sha256: digest.digest("hex") };
}

/** Preserve complete file membership, and refuse substituted links in authored/build trees. */
export async function treeCustody(directory: string) {
  assert.equal(await realpath(directory), directory, `Substituted tree ancestor: ${directory}`);
  const files: Awaited<ReturnType<typeof fileCustody>>[] = [];
  async function visit(dir: string) {
    assert((await lstat(dir)).isDirectory(), `Expected physical directory: ${dir}`);
    for (const entry of (await readdir(dir)).sort()) {
      const file = path.join(dir, entry);
      const stat = await lstat(file);
      assert(!stat.isSymbolicLink(), `Substituted tree link: ${file}`);
      if (stat.isDirectory()) await visit(file);
      else files.push({ ...(await fileCustody(file)), file: path.relative(directory, file) });
    }
  }
  await visit(directory);
  assert(files.length > 0, `Empty custody tree: ${directory}`);
  return files;
}

export const generatedWorkersFiles = [
  ...["alert", "button", "card", "checkbox", "dialog", "input", "switch", "tabs"].map(
    (name) => `docs/public/component-previews/${name}.png`,
  ),
  "npm/native/index.d.ts",
];
const sourceLinks = new Map([
  ["docs/public/logo.svg", "../../assets/logo.svg"],
  ["docs/public/logo-light.svg", "../../assets/logo-light.svg"],
]);
const buildProducerFiles = [
  "docs/package.json",
  "docs/scripts/build-ui-previews.ts",
  "docs/previews/ui/capture.ts",
  "npm/ui/scripts/reference-docs/examples.ts",
  "npm/native/package.json",
  "npm/native/scripts/sync-entrypoint.mjs",
  "crates/vize_vitrine/Cargo.toml",
];
function gitSource(root: string, source: string) {
  assert.match(source, /^[a-f0-9]{40}$/, "Expected immutable Actions source");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(
    git("rev-parse", "HEAD").trim(),
    source,
    "Actual checkout must match Actions source",
  );
  return git;
}
async function physicalCheckout(root: string, source: string, built: boolean) {
  assert.equal(await realpath(root), root, "Physical checkout root required");
  const git = gitSource(root, source);
  const status = git("status", "--porcelain", "-z", "--untracked-files=all")
    .split("\0")
    .filter(Boolean);
  for (const entry of status)
    assert(
      built && entry.startsWith(" M ") && generatedWorkersFiles.includes(entry.slice(3)),
      "Only the exact authored generated output census may change; staged/untracked source refuses",
    );
  const sourceFiles: (Awaited<ReturnType<typeof fileCustody>> & {
    mode: string;
    object: string;
    link?: string;
  })[] = [];
  const gitlinks: { file: string; object: string; state: "absent" | "empty" }[] = [];
  for (const entry of git("ls-files", "--stage", "-z").split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([a-f0-9]{40}) 0\t(.+)$/.exec(entry);
    assert(match, "Complete stage-zero tracked census required");
    const [, mode, object, relative] = match;
    const file = path.join(root, relative);
    assert.equal(
      await realpath(path.dirname(file)),
      path.dirname(file),
      "Physical source ancestor required",
    );
    if (mode === "160000") {
      const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat)
        assert(
          stat.isDirectory() && (await readdir(file)).length === 0,
          "Docs build must retain the original uninitialized fixture gitlinks",
        );
      gitlinks.push({ file: relative, object, state: stat ? "empty" : "absent" });
      continue;
    }
    if (mode === "120000") {
      const link = await readlink(file);
      assert.equal(
        link,
        sourceLinks.get(relative),
        "Only the exact original logo link objects are valid",
      );
      assert.equal(
        createHash("sha1")
          .update(`blob ${Buffer.byteLength(link)}\0`)
          .update(link)
          .digest("hex"),
        object,
      );
      assert.equal(
        await realpath(file),
        path.resolve(path.dirname(file), link),
        "Logo target ancestor changed",
      );
      sourceFiles.push({ ...(await fileCustody(file)), file: relative, mode, object, link });
    } else {
      assert(mode === "100644" || mode === "100755", "Unknown tracked object mode");
      assert.equal(await realpath(file), file, `Substituted source: ${relative}`);
      assert.equal(
        Boolean((await lstat(file)).mode & 0o111),
        mode === "100755",
        "Tracked executable mode changed",
      );
      sourceFiles.push({
        ...(await fileCustody(
          file,
          built && generatedWorkersFiles.includes(relative) ? undefined : object,
        )),
        file: relative,
        mode,
        object,
      });
    }
  }
  return { source, tree: git("rev-parse", "HEAD^{tree}").trim(), sourceFiles, gitlinks };
}
export async function workersCheckoutIdentity(root: string, source: string) {
  return physicalCheckout(root, source, false);
}
export async function workersGeneratedIdentity(
  root: string,
  source: string,
  before: Awaited<ReturnType<typeof workersCheckoutIdentity>>,
) {
  const after = await physicalCheckout(root, source, true);
  assert.equal(before.source, source);
  assert.equal(before.tree, after.tree);
  assert.deepEqual(before.gitlinks, after.gitlinks);
  const authored = (value: typeof after) =>
    value.sourceFiles.filter(({ file }) => !generatedWorkersFiles.includes(file));
  assert.deepEqual(
    authored(before),
    authored(after),
    "Every other tracked source must remain byte-exact",
  );
  const producerFiles = buildProducerFiles.map((file) => {
    const entry = before.sourceFiles.find((item) => item.file === file);
    assert(entry, "Complete original build producer source required");
    return entry;
  });
  const generated = generatedWorkersFiles.map((file) => {
    const old = before.sourceFiles.find((item) => item.file === file);
    const current = after.sourceFiles.find((item) => item.file === file);
    assert(
      old && current && old.mode === current.mode && old.object === current.object,
      "Complete nine-file generated census required",
    );
    const original = execFileSync("git", ["cat-file", "blob", old.object], { cwd: root });
    assert.equal(old.bytes, original.length);
    assert.equal(
      old.sha256,
      createHash("sha256").update(original).digest("hex"),
      "Generated input must match its original committed bytes",
    );
    return { file, before: old, after: current };
  });
  return { ...after, generated, producerFiles };
}
export async function retainWorkersGeneratedBytes(
  root: string,
  output: string,
  phase: "inputs" | "outputs",
) {
  for (const relative of generatedWorkersFiles) {
    const destination = path.join(output, `build-${phase}`, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, relative), destination);
  }
}
export async function verifyWorkersGeneratedBytes(
  output: string,
  generated: Awaited<ReturnType<typeof workersGeneratedIdentity>>["generated"],
) {
  assert.deepEqual(
    generated.map(({ file }) => file),
    generatedWorkersFiles,
  );
  for (const entry of generated) {
    for (const [phase, authority] of [
      ["inputs", entry.before],
      ["outputs", entry.after],
    ] as const) {
      const file = path.join(output, `build-${phase}`, entry.file);
      assert.equal(await realpath(file), file, "Physical original generated-byte packet required");
      const actual = await fileCustody(file);
      assert.equal(actual.bytes, authority.bytes);
      assert.equal(actual.sha256, authority.sha256, "Complete original generated bytes required");
    }
  }
}
export async function workersBuildProducerIdentity(root: string) {
  const require = createRequire(path.join(root, "npm/native/package.json"));
  const directory = path.dirname(await realpath(require.resolve("@napi-rs/cli/package.json")));
  return {
    node: { version: process.version, ...(await fileCustody(process.execPath)) },
    napi: { directory, files: await treeCustody(directory) },
  };
}
export async function workersSourceIdentity(
  root: string,
  dist: string,
  source: string,
  before: Awaited<ReturnType<typeof workersCheckoutIdentity>>,
) {
  const checkout = await workersGeneratedIdentity(root, source, before);
  const manifest = JSON.parse(await readFile(path.join(dist, "_og/manifest.json"), "utf8"));
  assert.equal(manifest.sourceSha, source, "Built Docs must identify the same source");
  const require = createRequire(path.join(root, "docs/package.json"));
  const playwrightPackage = require.resolve("playwright/package.json");
  const libraryRequire = createRequire(playwrightPackage);
  const libraries = [];
  for (const name of ["playwright", "playwright-core"]) {
    const directory = path.dirname(await realpath(libraryRequire.resolve(`${name}/package.json`)));
    libraries.push({ name, directory, files: await treeCustody(directory) });
  }
  const browser = resolvePuppeteerExecutablePath();
  assert(browser, "Actual renderer browser must exist");
  const browserIdentity = await fileCustody(browser);
  const fontCatalog = execFileSync("fc-list", ["--format", "%{file}\n"], { encoding: "utf8" });
  const fonts = [];
  for (const font of [...new Set(fontCatalog.trim().split("\n"))].sort())
    fonts.push(await fileCustody(font));
  assert(fonts.length > 0, "Full installed font census must exist");
  return {
    ...checkout,
    buildProducers: await workersBuildProducerIdentity(root),
    dist: { directory: dist, manifest, files: await treeCustody(dist) },
    libraries,
    node: { version: process.version, ...(await fileCustody(process.execPath)) },
    browser: {
      ...browserIdentity,
      version: execFileSync(browser, ["--version"], { encoding: "utf8" }).trim(),
    },
    fonts: { catalog: fontCatalog, files: fonts },
  };
}
