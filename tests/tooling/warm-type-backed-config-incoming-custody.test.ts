import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import {
  configIncomingCustody as manifest,
  qualifyConfigIncomingCustodyHost,
} from "../performance/support/warm-type-backed-config-incoming-custody.ts";
import { qualifyConfigRepairedReviewHost } from "../performance/support/warm-type-backed-config-repair-host.ts";
import { qualifyIssuedCompletionHost } from "../performance/support/warm-type-backed-issued-completion-host.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
const root = new URL("../../", import.meta.url);
const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const bodies = new Map<string, string | null>();
const actual: Digest = (side, file) => {
  const key = `${side}:${file}`;
  if (bodies.has(key)) return bodies.get(key)!;
  let body: Buffer | null;
  if (side === "before") {
    const result = spawnSync(
      "git",
      ["--no-replace-objects", "show", `${manifest.incomingSource}:${file}`],
      { cwd: root },
    );
    assert.ok(result.status === 0 || result.status === 128, result.stderr.toString());
    body = result.status === 0 ? result.stdout : null;
  } else {
    try {
      assert.ok(fs.lstatSync(new URL(file, root)).isFile(), file);
      body = fs.readFileSync(new URL(file, root));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      body = null;
    }
  }
  bodies.set(key, body === null ? null : sha(body));
  return bodies.get(key)!;
};
const qualify = (digest: Digest = actual, files = manifest.productionFiles) =>
  qualifyConfigRepairedReviewHost(files, new Set(), digest, qualifyIssuedCompletionHost);

test("the complete actual main composition retains all original witnesses and production bodies", () => {
  const result = qualify();
  assert.ok(result);
  assert.equal(result.files.length, 113);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.equal(result.ownedCompletionContext.completeExtensions.length, 29);
  assert.equal(result.configIncomingCustodyContext.before, "incoming");
  for (const file of manifest.productionFiles) {
    const original = spawnSync(
      "git",
      ["--no-replace-objects", "show", `${manifest.predecessorSource}:${file}`],
      { cwd: root },
    );
    assert.equal(original.status, 0, original.stderr.toString());
    assert.equal(actual("after", file), sha(original.stdout), file);
  }
});

test("each complete incoming custody side is mandatory and mixed generations refuse before delegation", () => {
  for (const scope of ["parent-pair", "inherited"] as const) {
    const complete: Digest = (side, file) => {
      const row = manifest.completeCustodyBodies.find(([name]) => name === file);
      return row
        ? side === "before" && scope === "parent-pair" && row[1] === null
          ? null
          : row[3]
        : null;
    };
    let calls = 0;
    const original = () => {
      calls++;
      return { files: manifest.productionFiles };
    };
    assert.ok(
      qualifyConfigIncomingCustodyHost(
        manifest.productionFiles,
        new Set(),
        complete,
        original,
        scope,
      ),
    );
    for (const [file, before, predecessor, incoming] of manifest.completeCustodyBodies)
      for (const side of ["before", "after"] as const)
        for (const replacement of [null, before, predecessor, incoming, "0".repeat(64)]) {
          if (replacement === complete(side, file)) continue;
          calls = 0;
          assert.equal(
            qualifyConfigIncomingCustodyHost(
              manifest.productionFiles,
              new Set(),
              (selected, name) =>
                selected === side && name === file ? replacement : complete(selected, name),
              original,
              scope,
            ),
            null,
            `${scope}:${side}:${file}`,
          );
          assert.equal(calls, 0);
        }
  }
});

test("every read original body and complete footprint stays required after incoming custody", () => {
  assert.ok(qualify());
  const readBodies = [...bodies];
  for (const [key, expected] of readBodies) {
    const separator = key.indexOf(":");
    const side = key.slice(0, separator);
    const file = key.slice(separator + 1);
    for (const replacement of [null, "0".repeat(64)]) {
      if (replacement === expected) continue;
      assert.equal(
        qualify((selected, name) =>
          selected === side && name === file ? replacement : actual(selected, name),
        ),
        null,
        key,
      );
    }
  }
  for (const file of manifest.productionFiles) {
    assert.equal(
      qualify(
        actual,
        manifest.productionFiles.filter((name) => name !== file),
      ),
      null,
      file,
    );
    assert.equal(qualify(actual, [...manifest.productionFiles, file]), null, file);
  }
  assert.equal(
    qualify(actual, [...manifest.productionFiles, "crates/vize_maestro/src/foreign.rs"]),
    null,
  );
  assert.ok(qualify());
});
