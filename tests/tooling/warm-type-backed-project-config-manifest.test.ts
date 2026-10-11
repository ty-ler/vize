import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { projectConfigManifest } from "../performance/support/warm-type-backed-project-config-manifest.ts";

const support = new URL("../performance/support/", import.meta.url);
const indexName = "warm-type-backed-project-config-manifest.json";
const readerName = "warm-type-backed-project-config-manifest.ts";
const parts = [
  "warm-type-backed-project-config-files-1.json",
  "warm-type-backed-project-config-files-2.json",
  "warm-type-backed-project-config-preserved-bodies.json",
  "warm-type-backed-project-config-harness-extensions.json",
];
async function isolatedReader(edit: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-complete-config-authority-"));
  try {
    for (const file of [readerName, indexName, ...parts])
      fs.copyFileSync(new URL(file, support), path.join(root, file));
    edit(root);
    return await import(pathToFileURL(path.join(root, readerName)).href);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await test("bounded storage reconstructs the entire original JSON value and complete90/51/3 pairs", () => {
  assert.equal(
    createHash("sha256").update(JSON.stringify(projectConfigManifest)).digest("hex"),
    "433e284764244dd3e171ff3513552054dbbd28b7b9603866c25871fc1dd904fc",
  );
  assert.equal(projectConfigManifest.files.length, 90);
  assert.equal(projectConfigManifest.preservedBodies.length, 51);
  assert.equal(projectConfigManifest.harnessExtensions.length, 3);
  for (const file of [readerName, indexName, ...parts])
    assert.ok(
      fs.readFileSync(new URL(file, support), "utf8").trimEnd().split("\n").length <= 350,
      file,
    );
});

await test("every named whole authority part is mandatory", async () => {
  for (const file of parts)
    await assert.rejects(
      isolatedReader((root) => fs.unlinkSync(path.join(root, file))),
      /ENOENT/,
    );
});

await test("any complete part byte drift refuses even when its JSON value is identical", async () => {
  for (const file of parts)
    await assert.rejects(
      isolatedReader((root) => fs.appendFileSync(path.join(root, file), "\n")),
      /complete authority part/,
    );
});

await test("unknown, duplicate, omitted and substituted part declarations refuse", async () => {
  for (const replacement of [
    [],
    [["foreign.json", "f".repeat(64)]],
    [
      [parts[0], "f".repeat(64)],
      [parts[0], "f".repeat(64)],
    ],
  ])
    await assert.rejects(
      isolatedReader((root) => {
        const file = path.join(root, indexName);
        const index = JSON.parse(fs.readFileSync(file, "utf8"));
        index.files = replacement;
        fs.writeFileSync(file, JSON.stringify(index));
      }),
      /AssertionError/,
    );
});
