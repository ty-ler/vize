import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

type Entry = {
  path: string;
  bytes: number;
  sha256: string;
  symlink?: { targetBase64: string; realTarget: string; kind: "file" | "directory" };
};
const CONFIG = "playgrounds/nuxt/nuxt.config.ts";
const GENERATED = new Set(["node_modules", ".git", ".nuxt", ".output", ".vize", ".cache", ".vite"]);
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export function sourceInventory(root: string, excluded: ReadonlySet<string>): Entry[] {
  root = fs.realpathSync(root);
  const entries: Entry[] = [];
  const closedTargets = new Set<string>([root]);
  function visit(directory: string): void {
    for (const name of fs.readdirSync(directory).sort()) {
      if (excluded.has(name)) continue;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file, { encoding: "buffer" });
        const realTarget = fs.realpathSync(file);
        assert.ok(
          realTarget.startsWith(`${root}${path.sep}`),
          `authority refuses unowned symlink: ${file}`,
        );
        const resolved = fs.statSync(file);
        assert.ok(resolved.isFile() || resolved.isDirectory());
        entries.push({
          path: path.relative(root, file),
          bytes: target.length,
          sha256: sha256(target),
          symlink: {
            targetBase64: target.toString("base64"),
            realTarget,
            kind: resolved.isDirectory() ? "directory" : "file",
          },
        });
      } else if (stat.isDirectory()) {
        closedTargets.add(file);
        visit(file);
      } else if (stat.isFile()) {
        closedTargets.add(file);
        const bytes = fs.readFileSync(file);
        entries.push({
          path: path.relative(root, file),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      } else assert.fail(`authority needs regular source files: ${file}`);
    }
  }
  visit(root);
  for (const entry of entries)
    if (entry.symlink)
      assert.ok(
        closedTargets.has(entry.symlink.realTarget),
        `symlink target bytes are outside the inventory: ${entry.path}`,
      );
  return entries;
}

function packageRoot(name: string, importer: string): string {
  const require = createRequire(importer);
  let resolved: string;
  try {
    resolved = require.resolve(`${name}/package.json`);
  } catch {
    resolved = require.resolve(name);
  }
  let directory = path.dirname(fs.realpathSync(resolved));
  for (;;) {
    const file = path.join(directory, "package.json");
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).name === name)
      return directory;
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `missing genuine package ${name}`);
    directory = parent;
  }
}

export function fixtureIdentity(cwd: string) {
  const actual = fs.realpathSync(cwd);
  const playground = path.join(actual, "playgrounds/nuxt/package.json");
  const nuxt = packageRoot("nuxt", playground);
  const builder = packageRoot("@nuxt/vite-builder", path.join(nuxt, "package.json"));
  const plugin = packageRoot("@vitejs/plugin-vue", path.join(builder, "package.json"));
  const vue = packageRoot("vue", playground);
  const providers = [
    ["nuxt", nuxt],
    ["@nuxt/vite-builder", builder],
    ["@vitejs/plugin-vue", plugin],
    ["vue", vue],
    ["@vue/compiler-sfc", packageRoot("@vue/compiler-sfc", path.join(plugin, "package.json"))],
    ["@vue/server-renderer", packageRoot("@vue/server-renderer", path.join(vue, "package.json"))],
    ["reka-ui", packageRoot("reka-ui", path.join(actual, "package.json"))],
  ].map(([name, directory]) => {
    assert.ok(name && directory);
    const stat = fs.statSync(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    return {
      name,
      directory,
      inode: stat.ino,
      device: stat.dev,
      version: manifest.version,
      files: sourceInventory(directory, new Set(["node_modules"])),
    };
  });
  const stat = fs.statSync(actual);
  const source = sourceInventory(actual, GENERATED).filter((entry) => entry.path !== CONFIG);
  return {
    cwd: actual,
    inode: stat.ino,
    device: stat.dev,
    providers,
    source,
    fixture: JSON.parse(fs.readFileSync(path.join(actual, ".vize-fixture-source.json"), "utf8")),
  };
}
