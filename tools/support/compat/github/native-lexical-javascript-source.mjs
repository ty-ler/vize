import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  authenticateCanonProductSource,
  canonProductSourcePaths,
  canonProductSourceMetadataPaths,
  retainedCanonProductSource,
} from "./canon-product-source-context.mjs";
import {
  authenticateJavaScriptSfcSource,
  javascriptSfcSourcePaths,
  javascriptSfcContextPaths,
} from "./javascript-sfc-source-context.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const supplementalHelpers = [
  ...javascriptSfcContextPaths,
  ...canonProductSourceMetadataPaths,
  "tools/support/compat/github/native-lexical-javascript-source.mjs",
];
export const nativeLexicalSourcePaths = (manifest, helpers) => [
  ...new Set([
    ...helpers,
    ...manifest.files.map(([file]) => file),
    ...manifest.corpusBodies.map(([file]) => file),
    "tests/performance/support/warm-type-backed-lexical-dollar-manifest.json",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "crates/vize_canon/Cargo.toml",
    "crates/vize_canon/src/lib.rs",
    ...javascriptSfcSourcePaths,
    ...canonProductSourcePaths,
    ...supplementalHelpers,
  ]),
];

/** Raw copied metadata remains actual; only the unchanged lexical table reads historical source. */
export function validateNativeLexicalSources(output, metadata, manifest, helpers) {
  assert.deepEqual(
    metadata.copied.map((entry) => entry.file).sort((a, b) => a.localeCompare(b)),
    nativeLexicalSourcePaths(manifest, helpers).sort((a, b) => a.localeCompare(b)),
  );
  for (const name of [...helpers, ...supplementalHelpers]) {
    const actual = new URL(`../../../../${name}`, import.meta.url);
    assert.ok(fs.lstatSync(actual).isFile());
    const copied = path.join(output, "source", name);
    assert.ok(fs.lstatSync(copied).isFile());
    assert.equal(fs.lstatSync(copied).mode & 0o777, 0o644);
    assert.equal(fs.lstatSync(actual).mode & 0o777, 0o644);
    assert.equal(
      metadata.copied.find((entry) => entry.file === name).sha256,
      digest(fs.readFileSync(actual)),
    );
  }
  const receipt = authenticateCanonProductSource(metadata.source.root);
  assert.equal(receipt.head, metadata.source.head);
  for (const entry of metadata.copied) {
    const target = path.join(output, "source", entry.file),
      actual = path.join(metadata.source.root, entry.file);
    assert.equal(fs.lstatSync(target).mode & 0o777, 0o644);
    assert.deepEqual(
      fs.readFileSync(target),
      fs.readFileSync(actual),
      "literal current copied source: " + entry.file,
    );
  }
  const context = authenticateJavaScriptSfcSource(
    (file) => retainedCanonProductSource(receipt, "original", file).body,
  );
  for (const [file, , expected] of [...manifest.files, ...manifest.corpusBodies])
    assert.equal(digest(context.historicalAfter(file)), expected);
  return context.receipt;
}
