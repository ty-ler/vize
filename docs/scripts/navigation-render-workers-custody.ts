import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { resolvePuppeteerExecutablePath } from "../browser-path.js";

export async function fileCustody(file: string) {
  const physical = await realpath(file);
  const stat = await lstat(physical);
  assert(stat.isFile(), `Expected physical file: ${file}`);
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(physical)) digest.update(bytes);
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

export async function workersSourceIdentity(root: string, dist: string, source: string) {
  assert.match(source, /^[a-f0-9]{40}$/, "Expected immutable Actions source");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "HEAD"), source, "Actual checkout must match Actions source");
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Tracked source changed");
  const manifest = JSON.parse(await readFile(path.join(dist, "_og/manifest.json"), "utf8"));
  assert.equal(manifest.sourceSha, source, "Built Docs must identify the same source");
  const authored = git(
    "ls-files",
    "-z",
    "docs",
    "package.json",
    "pnpm-lock.yaml",
    ".github/actions/benchmark-docs-workers",
    ".github/workflows/ci-walltime-benchmark.yml",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const sourceFiles = [];
  for (const relative of authored) {
    const file = path.join(root, relative);
    assert(!(await lstat(file)).isSymbolicLink(), `Substituted source: ${relative}`);
    assert.equal(await realpath(file), file, `Substituted source ancestor: ${relative}`);
    sourceFiles.push({ ...(await fileCustody(file)), file: relative });
  }
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
    source,
    tree: git("rev-parse", "HEAD^{tree}"),
    sourceFiles,
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
