import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { lockedProviders } from "../_helpers/app-check-prepare.ts";
import { checkPolicies, type Source } from "../_helpers/app-check-custody.ts";

const kuromoji =
  "https://codeload.github.com/VOICEVOX/kuromoji.js/tar.gz/0e8d670cd3df64217d0502d3bb71f431531ff353";

function fixture(name = "kuromoji", locator = kuromoji, version = "0.0.1") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "app-provider-identity-")));
  const cwd = path.join(root, "source");
  fs.mkdirSync(path.join(cwd, "node_modules/.pnpm"), { recursive: true });
  const manifest = {
    name: "authored-app",
    version: "1.0.0",
    packageManager: "pnpm@10.28.2",
    dependencies: { [name]: locator },
  };
  const packageFile = path.join(cwd, "node_modules", name, "package.json");
  const packageBytes = Buffer.from(JSON.stringify({ name, version }));
  const lock = {
    importers: { ".": { dependencies: { [name]: { specifier: locator, version: locator } } } },
    packages: { [`${name}@${locator}`]: { resolution: { tarball: locator }, version } },
  };
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const writeLock = () => write(path.join(cwd, "pnpm-lock.yaml"), lock);
  write(packageFile, JSON.parse(packageBytes.toString()));
  writeLock();
  write(path.join(cwd, "node_modules/.modules.yaml"), {
    included: { dependencies: true, devDependencies: true },
  });
  write(path.join(cwd, "node_modules/.pnpm/lock.yaml"), lock);
  const bytes = Buffer.from(JSON.stringify(manifest));
  const source: Source = {
    cwd,
    policy: checkPolicies[2],
    manifest,
    submodules: [],
    files: [
      {
        file: "package.json",
        mode: "100644",
        oid: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
        bytes,
      },
    ],
  };
  return { root, source, lock, packageFile, write, writeLock };
}

function unchanged(f: ReturnType<typeof fixture>, check: () => void) {
  const files = [path.join(f.source.cwd, "pnpm-lock.yaml"), f.packageFile];
  const before = files.map((file) => fs.readFileSync(file));
  try {
    check();
  } finally {
    for (const [index, file] of files.entries())
      assert.deepEqual(fs.readFileSync(file), before[index]);
  }
}

test("the authored Voicevox Git tarball locator resolves its explicit package version", () => {
  const f = fixture();
  try {
    unchanged(f, () => assert.ok(lockedProviders(f.source).includes(f.packageFile)));
  } finally {
    fs.rmSync(f.root, { recursive: true });
  }
});

test("HTTPS package identity is generic and requires its exact resolved locator, name and version", () => {
  const f = fixture("other-provider", "https://example.invalid/source/abcdef.tar.gz", "2.3.4");
  try {
    const resolved = f.lock.packages["other-provider@https://example.invalid/source/abcdef.tar.gz"];
    unchanged(f, () => assert.ok(lockedProviders(f.source).includes(f.packageFile)));
    for (const replacement of [undefined, "", 234]) {
      (resolved as { version?: unknown }).version = replacement;
      f.writeLock();
      unchanged(f, () => assert.throws(() => lockedProviders(f.source)));
    }
    resolved.version = "2.3.4";
    resolved.resolution.tarball += "?different-source";
    f.writeLock();
    unchanged(f, () =>
      assert.throws(() => lockedProviders(f.source), /locked tarball locator mismatch/),
    );
    resolved.resolution.tarball = f.lock.importers["."].dependencies["other-provider"].specifier;
    f.writeLock();
    for (const actual of [
      { name: "substitute", version: "2.3.4" },
      { name: "other-provider", version: "2.3.5" },
    ]) {
      f.write(f.packageFile, actual);
      unchanged(f, () => assert.throws(() => lockedProviders(f.source)));
    }
    f.write(f.packageFile, { name: "other-provider", version: "2.3.4" });
    delete (f.lock.packages as Record<string, unknown>)[
      "other-provider@https://example.invalid/source/abcdef.tar.gz"
    ];
    f.writeLock();
    unchanged(f, () =>
      assert.throws(() => lockedProviders(f.source), /locked tarball locator mismatch/),
    );
  } finally {
    fs.rmSync(f.root, { recursive: true });
  }
});

test("registry, alias, local and link providers retain their existing identity contracts", () => {
  for (const [locator, actualName, actualVersion] of [
    ["1.2.3", "kuromoji", "1.2.3"],
    ["other-package@1.2.3", "other-package", "1.2.3"],
    ["file:./local-package", "local-package", "1.2.3"],
    ["link:./local-package", "local-package", "1.2.3"],
  ]) {
    const f = fixture("kuromoji", locator);
    try {
      const actual = { name: actualName, version: actualVersion };
      f.write(f.packageFile, actual);
      f.write(path.join(f.source.cwd, "local-package/package.json"), actual);
      unchanged(f, () => assert.ok(lockedProviders(f.source).includes(f.packageFile)));
      if (!locator.startsWith("link:")) {
        f.write(f.packageFile, { name: actualName, version: "9.9.9" });
        unchanged(f, () => assert.throws(() => lockedProviders(f.source)));
      }
    } finally {
      fs.rmSync(f.root, { recursive: true });
    }
  }
});

test("tarball packages cannot borrow an ambient physical provider or omit authored dev dependencies", () => {
  const f = fixture();
  try {
    const outside = path.join(f.root, "ambient");
    fs.mkdirSync(outside);
    fs.copyFileSync(f.packageFile, path.join(outside, "package.json"));
    fs.rmSync(path.dirname(f.packageFile), { recursive: true });
    fs.symlinkSync(outside, path.dirname(f.packageFile), "dir");
    assert.throws(() => lockedProviders(f.source), /ambient kuromoji provider/);
    fs.unlinkSync(path.dirname(f.packageFile));
    fs.mkdirSync(path.dirname(f.packageFile));
    fs.copyFileSync(path.join(outside, "package.json"), f.packageFile);
    f.write(path.join(f.source.cwd, "node_modules/.modules.yaml"), {
      included: { dependencies: true, devDependencies: false },
    });
    unchanged(f, () =>
      assert.throws(() => lockedProviders(f.source), /complete authored dev dependency graph/),
    );
  } finally {
    fs.rmSync(f.root, { recursive: true });
  }
});
