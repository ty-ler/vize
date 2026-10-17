import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyInstalledImages } from "../../../tools/support/compat/npm/smoke-release-config-evidence.ts";

const expected = "a".repeat(64);
const fixture = () =>
  ["app", "control"].map((name) => ({
    project: `/workspace/packages/${name}`,
    workspace: "/workspace",
    native: {
      binaries: [{ path: "/workspace/node_modules/native/provider.node", sha256: expected }],
    },
    corsa: {
      name: "@typescript/typescript-linux-x64",
      manifest: {
        path: "/workspace/node_modules/corsa/package.json",
        sha256: expected,
        contents: "{}",
      },
    },
  }));

test("both independent installed siblings use the source-built native image", () => {
  verifyInstalledImages(fixture(), expected);
});

test("an installed sibling with a stale image or outside fallback is rejected", () => {
  const stale = fixture();
  stale[1].native.binaries[0].sha256 = "b".repeat(64);
  assert.throws(() => verifyInstalledImages(stale, expected), /installed native image/u);
  const outside = fixture();
  outside[1].native.binaries[0].path = "/global/provider.node";
  assert.throws(() => verifyInstalledImages(outside, expected));
});

test("a missing sibling, duplicate sibling, or multiple loaded images cannot pass", () => {
  const images = fixture();
  assert.throws(() => verifyInstalledImages(images.slice(0, 1), expected));
  assert.throws(() => verifyInstalledImages([images[0], images[0]], expected));
  images[1].native.binaries.push({ ...images[1].native.binaries[0] });
  assert.throws(() => verifyInstalledImages(images, expected), /one loaded native provider/u);
});

test("a partial failed campaign saves its failure receipt and remains nonzero", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-config-evidence-"));
  try {
    const script = fileURLToPath(
      new URL(
        "../../../tools/support/compat/npm/smoke-release-config-evidence.ts",
        import.meta.url,
      ),
    );
    const child = spawnSync(process.execPath, [script, "collect"], {
      env: { ...process.env, PACKED_CONFIG_OUTPUT: directory },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.notEqual(child.status, 0);
    const receipt = JSON.parse(
      fs.readFileSync(path.join(directory, "installed-images.json"), "utf8"),
    );
    assert.equal(receipt.passed, false);
    assert.match(receipt.failure, /source\.json/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
