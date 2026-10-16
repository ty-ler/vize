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
  ],
  [
    "lint-default-migrations",
    "30f05bb221d3e33149b40046df704906bfb8bdbe0107a0d043af1f32965eb0bd",
    [
      [3, "functional", 10, 20, 10, 20],
      [4, "combined", 10, 20, 10, 20],
      [10, "unicode-crlf", 30, 40, 10, 20],
    ],
  ],
];
// Reviewed native evolution, preserving both frozen fixture versions:
// https://github.com/ubugeeei-prod/vize/commit/8291843d8faa040d1378033a5d4732a4c85be654
// #9213 adds exactly these first-numeric keyCode fixes; all offsets are authored
// UTF-8 bytes, including the Unicode/CRLF witness. No other packet delta is allowed.
const numericFixes = [
  [0, "numeric-shorthand", 0, 0, 39, 41, "enter"],
  [1, "numeric-longhand", 1, 0, 43, 45, "escape"],
  [2, "numeric-combined", 0, 0, 39, 41, "enter"],
  [4, "combined", 1, 1, 50, 52, "enter"],
  [10, "unicode-crlf", 1, 1, 70, 72, "escape"],
];
function validateRanges(original, current, changes, fixes) {
  const inverse = structuredClone(current);
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
  for (const [index, id, diagnosticIndex, essentialIndex, start, end, name] of fixes) {
    const row = inverse.cases[index];
    assert.equal(row.id, id);
    for (const [field, finding] of [
      ["diagnostics", diagnosticIndex],
      ["essentialDiagnostics", essentialIndex],
    ]) {
      assert.equal(row[field][finding].rule_name, "vue/no-deprecated-v-on-number-modifiers");
      assert.equal(original.cases[index][field][finding].fix, null);
      assert.deepEqual(row[field][finding].fix, {
        message: "Replace the numeric keyCode modifier with a named key",
        edits: [{ start, end, new_text: name }],
      });
      row[field][finding].fix = null;
    }
  }
  if (fixes.length) {
    // #9213 selects only the first numeric modifier in this exact authored
    // .13.27 input. Preserve and authenticate the previous complete .27 packet.
    const row = inverse.cases[2];
    const old = original.cases[2];
    assert.equal(row.id, "numeric-combined");
    assert.equal(
      old.source,
      '<template><button type="button" @keyup.13.27.stop="submit">Submit</button></template>\n',
    );
    const message =
      "The numeric keyCode modifier '.27' on 'v-on' was removed in Vue 3; use a named key instead";
    const native = {
      end: 44,
      fix: null,
      help: null,
      labels: [],
      message,
      rule_name: "vue/no-deprecated-v-on-number-modifiers",
      severity: "error",
      start: 42,
    };
    const lsp = {
      code: "vue/no-deprecated-v-on-number-modifiers",
      codeDescription: {
        href: "https://eslint.vuejs.org/rules/no-deprecated-v-on-number-modifiers.html",
      },
      message:
        message +
        "\n\nHelp: Replace the numeric keyCode modifier with a named key (e.g. @keyup.enter instead of @keyup.13).",
      range: { end: { character: 44, line: 0 }, start: { character: 42, line: 0 } },
      severity: 1,
      source: "vize/lint",
    };
    for (const [field, expected] of [
      ["diagnostics", native],
      ["essentialDiagnostics", native],
      ["lspDiagnostics", lsp],
    ]) {
      assert.equal(old[field].length, 2);
      assert.deepEqual(old[field][1], expected);
      assert.equal(row[field].length, 1);
      row[field].push(structuredClone(expected));
    }
  }
  assert.deepEqual(inverse, original);
}
void test("current whole preset packets retain seven range witnesses and reviewed first-numeric selection and fixes", () => {
  for (const [directory, hash, changes] of vectors) {
    const fixture = path.join(root, "tests/_fixtures", directory);
    const old = fs.readFileSync(path.join(fixture, "cases.json"));
    assert.equal(digest(old), hash);
    const original = JSON.parse(old);
    const current = JSON.parse(fs.readFileSync(path.join(fixture, "current-range-cases.json")));
    const fixes = directory === "lint-default-migrations" ? numericFixes : [];
    validateRanges(original, current, changes, fixes);
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
    if (fixes.length)
      mutations.push(
        (packet) => {
          packet.cases[0].diagnostics[0].fix.message += "foreign";
        },
        (packet) => {
          packet.cases[0].diagnostics[0].fix.edits[0].start++;
        },
        (packet) => {
          packet.cases[0].diagnostics[0].fix.edits[0].new_text = "unreviewed";
        },
        (packet) => {
          packet.cases[0].essentialDiagnostics[0].fix.edits.push({
            start: 0,
            end: 1,
            new_text: "foreign",
          });
        },
        (packet) => {
          packet.cases[3].diagnostics[0].fix = packet.cases[0].diagnostics[0].fix;
        },
        (packet) => {
          packet.cases[1].diagnostics.reverse();
        },
        (packet) => {
          packet.cases[2].diagnostics.push(original.cases[2].diagnostics[1]);
        },
      );
    for (const mutate of mutations) {
      const changed = structuredClone(current);
      mutate(changed);
      assert.throws(() => validateRanges(original, changed, changes, fixes));
    }
  }
});
