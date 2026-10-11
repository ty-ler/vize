import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import {
  assertNativeTerminalLocks,
  qualifyNativeTerminalHost,
} from "../performance/support/warm-type-backed-native-terminal-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL(
      "../performance/support/warm-type-backed-native-terminal-manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  originalSource: string;
  files: Array<[string, string | null, string]>;
  preservedBodies: Array<[string, string]>;
};
const entries = new Map(manifest.files.map(([file, before, after]) => [file, { before, after }]));
const preserved = new Map(manifest.preservedBodies);
const production = [...entries.keys()];
const digest = (side: "before" | "after", file: string) =>
  entries.get(file)?.[side] ?? preserved.get(file) ?? null;
const locks = (side: "before" | "after") =>
  Object.fromEntries(
    ["Cargo.toml", "Cargo.lock", "package.json", "pnpm-lock.yaml", "rust-toolchain.toml"].map(
      (file) => [file, digest(side, file)!],
    ),
  );

test("the complete reviewed repair preserves every original request and admits its exact Cargo source pair", () => {
  const receipt = qualifyNativeTerminalHost(production, new Set(), digest);
  assert.ok(receipt);
  assert.equal(receipt.completeBodyPairs, production.length);
  assert.equal(receipt.preservedBodyPairs, 23);
  assert.deepEqual(receipt.files, production);
  assertNativeTerminalLocks(locks("before"), locks("after"), receipt);
  assert.throws(() => assertNativeTerminalLocks(locks("before"), locks("after"), null));
});

test("every current whole source and original request body matches the finite review", () => {
  const actual = (side: "before" | "after", file: string) =>
    side === "before"
      ? digest(side, file)
      : createHash("sha256")
          .update(fs.readFileSync(new URL("../../" + file, import.meta.url)))
          .digest("hex");
  assert.ok(qualifyNativeTerminalHost(production, new Set(), actual));
});

test("every original and reviewed member including absent original vendor bodies is bound", () => {
  for (const [file] of [...manifest.files, ...manifest.preservedBodies])
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyNativeTerminalHost(production, new Set(), (candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : digest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
});

test("partial, duplicated and foreign production closures cannot enter the original400 run", () => {
  for (const file of production) {
    assert.equal(
      qualifyNativeTerminalHost(
        production.filter((p) => p !== file),
        new Set(),
        digest,
      ),
      null,
      file,
    );
    assert.equal(qualifyNativeTerminalHost([...production, file], new Set(), digest), null, file);
  }
  assert.equal(
    qualifyNativeTerminalHost(
      [...production, "vendor/corsa_core/src/unknown.rs"],
      new Set(),
      digest,
    ),
    null,
  );
  const owned = new Set(["crates/vize_maestro/src/ide/workspace_symbols.rs"]);
  assert.ok(qualifyNativeTerminalHost([...production, ...owned], owned, digest));
  assert.equal(qualifyNativeTerminalHost([...owned], owned, digest), null);
});

test("original lock or provider changes still refuse even with a valid complete source receipt", () => {
  const receipt = qualifyNativeTerminalHost(production, new Set(), digest);
  assert.ok(receipt);
  for (const file of Object.keys(locks("before"))) {
    assert.throws(() =>
      assertNativeTerminalLocks(
        { ...locks("before"), [file]: "f".repeat(64) },
        locks("after"),
        receipt,
      ),
    );
    assert.throws(() =>
      assertNativeTerminalLocks(
        locks("before"),
        { ...locks("after"), [file]: "f".repeat(64) },
        receipt,
      ),
    );
  }
  assert.throws(() =>
    assertNativeTerminalLocks(
      locks("before"),
      { ...locks("after"), "foreign.lock": "f".repeat(64) },
      receipt,
    ),
  );
});

test("the Cargo lock changes only registry custody for the same two published 1.14 packages", () => {
  const original = execFileSync("git", ["show", `${manifest.originalSource}:Cargo.lock`], {
    encoding: "utf8",
  });
  const expected = original
    .split("[[package]]")
    .map((section) => {
      if (!/^\nname = "corsa_(?:core|lsp)"\nversion = "1\.14\.0"\n/u.test(section)) return section;
      return section.replace(
        /^source = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"\nchecksum = "[a-f0-9]{64}"\n/mu,
        "",
      );
    })
    .join("[[package]]");
  assert.equal(fs.readFileSync(new URL("../../Cargo.lock", import.meta.url), "utf8"), expected);
});
