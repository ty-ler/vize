import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "../..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = fs.readFileSync(
  path.join(root, "tests/_fixtures/lint-deprecation-source-composition.json.gz"),
);
assert.equal(digest(bytes), "65b7af986b182c73aab4a109788500aad2c4fce52168cebc47a3560748389b30");
const receipt = JSON.parse(gunzipSync(bytes));
const names = [
  "crates/vize_patina/src/preset/default_migration_tests.rs",
  "crates/vize_patina/src/rules/vue/no_deprecated_functional_template.rs",
  "tests/tooling/lint-default-correctness-reference.mjs",
];
function validate(packet) {
  assert.equal(packet.schema, "vize.patina.deprecation-source-composition");
  assert.equal(packet.version, 1);
  assert.equal(packet.main, "bd5702c0a4d5fb3bb64487794fc45f6f876e6e38");
  assert.equal(packet.prepared, "f652e03ba21cd3f1fdd3438c68b3cd366304a2e0");
  assert.equal(packet.sourceOnly, true);
  assert.equal(packet.native, false);
  assert.equal(packet.performance, false);
  assert.deepEqual(
    packet.changes.map((row) => row.path),
    names,
  );
  const { current: before, ...oldRest } = packet.mainManifest;
  const { current: after, ...newRest } = packet.afterManifest;
  assert.equal(before.length, 323);
  assert.equal(after.length, 323);
  assert.deepEqual(newRest, oldRest);
  const owned = new Map(packet.changes.map((row) => [row.path, row]));
  assert.equal(owned.size, 3);
  for (let index = 0; index < before.length; index++) {
    assert.equal(after[index].path, before[index].path);
    const change = owned.get(before[index].path);
    if (change) {
      assert.deepEqual(change.beforeRow, before[index]);
      assert.deepEqual(change.afterRow, after[index]);
      assert.deepEqual(
        packet.preparedManifest.current.find((row) => row.path === change.path),
        change.afterRow,
      );
    } else assert.deepEqual(after[index], before[index]);
  }
  for (const change of packet.changes) {
    for (const side of ["before", "after"]) {
      const body = Buffer.from(change[side]);
      const row = change[side + "Row"];
      assert.equal(body.length, row.bytes);
      assert.equal(digest(body), row.sha256);
      assert.equal(
        createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex"),
        row.gitBlob,
      );
      assert.equal(row.mode, "100644");
    }
    let composed = Buffer.from(change.before);
    let previous = composed.length + 1;
    for (const edit of change.edits.toReversed()) {
      const removed = Buffer.from(edit.before);
      assert(edit.offset + removed.length <= previous);
      assert.deepEqual(composed.subarray(edit.offset, edit.offset + removed.length), removed);
      composed = Buffer.concat([
        composed.subarray(0, edit.offset),
        Buffer.from(edit.after),
        composed.subarray(edit.offset + removed.length),
      ]);
      previous = edit.offset;
    }
    assert.deepEqual(composed, Buffer.from(change.after));
    let restored = composed;
    for (const edit of change.edits) {
      const location = edit.offset;
      const added = Buffer.from(edit.after);
      assert.deepEqual(restored.subarray(location, location + added.length), added);
      restored = Buffer.concat([
        restored.subarray(0, location),
        Buffer.from(edit.before),
        restored.subarray(location + added.length),
      ]);
      // Restoring each preceding edit returns later offsets to the original source.
    }
    assert.deepEqual(restored, Buffer.from(change.before));
  }
}
void test("three reviewed whole source inverses preserve all 320 other current rows and historical authorities", () => {
  validate(receipt);
});
void test("whole composition refuses extra, omitted, reordered and mutated closed source rows", () => {
  const mutations = [
    (packet) => packet.afterManifest.current.pop(),
    (packet) => packet.afterManifest.current.reverse(),
    (packet) => packet.afterManifest.current.push(packet.afterManifest.current[0]),
    (packet) => {
      packet.afterManifest.current[0].sha256 = "0".repeat(64);
    },
    (packet) => {
      packet.afterManifest.literalFrames[0].sha256 = "0".repeat(64);
    },
    (packet) => packet.changes.pop(),
    (packet) => {
      packet.changes[0].after += "foreign";
    },
    (packet) => {
      packet.changes[0].edits[0].before += "foreign";
    },
    (packet) => {
      packet.changes[0].edits[0].offset++;
    },
    (packet) => {
      packet.native = true;
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(receipt);
    mutate(changed);
    assert.throws(() => validate(changed));
  }
});
const vectors = [
  [
    "lint-default-correctness",
    "7fa33faea83c868ad5bb01cacd624240486ecea35177a637f09e56ec5f73e9fc",
    [
      [0, "sync", 18, 37, 18, 37],
      [2, "slot-scope", 28, 38, 28, 38],
      [4, "full-modifiers", 18, 49, 18, 49],
      [5, "utf8-crlf", 40, 59, 32, 51],
    ],
    [],
  ],
  [
    "lint-default-migrations",
    "30f05bb221d3e33149b40046df704906bfb8bdbe0107a0d043af1f32965eb0bd",
    [
      [3, "functional", 10, 20, 10, 20],
      [4, "combined", 10, 20, 10, 20],
      [10, "unicode-crlf", 30, 40, 10, 20],
    ],
    [
      [0, "numeric-shorthand", 39, 41, "enter"],
      [1, "numeric-longhand", 43, 45, "escape"],
      [2, "numeric-combined", 39, 41, "enter"],
      [4, "combined", 50, 52, "enter"],
      [10, "unicode-crlf", 70, 72, "escape"],
    ],
  ],
];
function validateCurrentPacket(original, current, changes, numericFixes) {
  const inverse = structuredClone(current);
  // #9213 intentionally adds named-key fixes and reports only the first
  // numeric modifier. Keep the original packets immutable and invert just
  // those approved changes, including the complete fix and LSP cardinality.
  for (const [index, id, start, end, new_text] of numericFixes) {
    const row = inverse.cases[index];
    assert.equal(row.id, id);
    for (const field of ["diagnostics", "essentialDiagnostics"]) {
      const findings = row[field].filter(
        (finding) => finding.rule_name === "vue/no-deprecated-v-on-number-modifiers",
      );
      assert.equal(findings.length, 1);
      assert.deepEqual(findings[0].fix, {
        message: "Replace the numeric keyCode modifier with a named key",
        edits: [{ start, end, new_text }],
      });
      findings[0].fix = null;
    }
  }
  if (numericFixes.length) {
    const row = inverse.cases[2];
    const old = original.cases[2];
    assert.equal(row.id, "numeric-combined");
    for (const field of ["diagnostics", "essentialDiagnostics", "lspDiagnostics"]) {
      assert.equal(row[field].length, 1);
      assert.equal(old[field].length, 2);
      row[field].push(old[field][1]);
    }
  }
  for (const [index, id, start, end, lspStart, lspEnd] of changes) {
    const row = inverse.cases[index];
    const old = original.cases[index];
    assert.equal(row.id, id);
    assert.deepEqual([row.diagnostics[0].start, row.diagnostics[0].end], [start, end]);
    for (const field of ["diagnostics", "essentialDiagnostics"]) {
      if (row[field]) {
        assert.deepEqual([row[field][0].start, row[field][0].end], [start, end]);
        row[field][0].start = old[field][0].start;
        row[field][0].end = old[field][0].end;
      }
    }
    assert.deepEqual(
      [row.lspDiagnostics[0].range.start.character, row.lspDiagnostics[0].range.end.character],
      [lspStart, lspEnd],
    );
    row.lspDiagnostics[0].range.start.character = old.lspDiagnostics[0].range.start.character;
    row.lspDiagnostics[0].range.end.character = old.lspDiagnostics[0].range.end.character;
  }
  assert.deepEqual(inverse, original);
}
void test("current whole preset packets retain approved spans and numeric-key migrations", () => {
  for (const [directory, hash, changes, numericFixes] of vectors) {
    const fixture = path.join(root, "tests/_fixtures", directory);
    const old = fs.readFileSync(path.join(fixture, "cases.json"));
    assert.equal(digest(old), hash);
    const original = JSON.parse(old);
    const current = JSON.parse(fs.readFileSync(path.join(fixture, "current-range-cases.json")));
    validateCurrentPacket(original, current, changes, numericFixes);
    const mutations = [
      (packet) => {
        packet.cases[0].source += "foreign";
      },
      (packet) => {
        packet.cases[0].diagnostics[0].message += "foreign";
      },
      (packet) => {
        packet.cases[changes[0][0]].diagnostics[0].start++;
      },
      (packet) => {
        packet.cases[changes[0][0]].lspDiagnostics[0].range.start.line++;
      },
      (packet) => packet.cases.pop(),
      (packet) => packet.cases.reverse(),
    ];
    if (numericFixes.length) {
      mutations.push(
        (packet) => {
          packet.cases[0].diagnostics[0].fix = null;
        },
        (packet) => {
          packet.cases[0].diagnostics[0].fix.edits[0].new_text = "escape";
        },
        (packet) => {
          packet.cases[0].essentialDiagnostics[0].fix.edits[0].start++;
        },
        (packet) => {
          packet.cases[0].diagnostics[0].fix.message += "foreign";
        },
        (packet) => {
          packet.cases[0].diagnostics[0].fix.edits.push({ start: 0, end: 0, new_text: "foreign" });
        },
        (packet) => {
          packet.cases[2].diagnostics.push(original.cases[2].diagnostics[1]);
        },
        (packet) => {
          packet.cases[2].lspDiagnostics.push(original.cases[2].lspDiagnostics[1]);
        },
      );
    }
    for (const mutate of mutations) {
      const changed = structuredClone(current);
      mutate(changed);
      assert.throws(() => validateCurrentPacket(original, changed, changes, numericFixes));
    }
  }
});
