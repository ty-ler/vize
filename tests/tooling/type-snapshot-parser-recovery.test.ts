import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeParserRecovery } from "../../tools/benchmarks/scripts/type-snapshot-parser-recovery.ts";
import { normalizeTypecheckResult } from "../../tools/benchmarks/scripts/typecheck-command.mjs";

const warning =
  "\u001b[33mwarning:\u001b[0m corsa: Corsa CLI fast path unavailable; degraded to the slower project-session API (check failure). Type checking continues on a slower path.";
const recovered = {
  status: 1,
  stderr: `${warning}\nerror handling method 'exit': EOF\n`,
  stdout: JSON.stringify({
    files: [
      {
        file: "Comp0.vue",
        diagnostics: ["error:1:59 [TS1260] Keywords cannot contain escape characters."],
      },
      {
        file: "shared.ts",
        diagnostics: ["error:1:21 [TS2304] Cannot find name 'LeafGlobal'."],
      },
    ],
    errorCount: 2,
    warningCount: 0,
  }),
};

test("intentional malformed parity retains syntax and semantic diagnostics and raw stderr", () => {
  for (const phase of ["parity", "parity-profile"]) {
    const result = normalizeParserRecovery(recovered, true, phase);
    assert.equal(result.stdout, recovered.stdout);
    assert.equal(result.stderr, "");
    assert.match(recovered.stderr, /EOF/u);
    const normalized = normalizeTypecheckResult(result, process.cwd(), "json");
    assert.equal(normalized.diagnostics.length, 2);
    assert.equal(normalized.status, 1);
  }
});

test("successful session shutdown does not require the optional EOF notice", () => {
  assert.equal(
    normalizeParserRecovery({ ...recovered, stderr: `${warning}\n` }, true, "parity").stderr,
    "",
  );
});

test("timed, cold, gate and unmarked fixtures still reject recovery stderr", () => {
  for (const [expected, phase] of [
    [false, "parity"],
    [true, "cold"],
    [true, "timed-0"],
    [true, "warmup-0"],
    [true, "gate-corpus"],
    [true, "profile"],
  ] as const) {
    const result = normalizeParserRecovery(recovered, expected, phase);
    assert.equal(result, recovered);
    assert.throws(() => normalizeTypecheckResult(result, process.cwd(), "json"), /stderr/u);
  }
});

test("unknown, duplicated, missing or different-cause notices remain errors", () => {
  for (const stderr of [
    `${recovered.stderr}unexpected failure\n`,
    `${warning}\n${warning}\n`,
    "error handling method 'exit': EOF\n",
    warning.replace("check failure", "spawn failure"),
    warning.replace("check failure", "parse failure"),
  ]) {
    const result = { ...recovered, stderr };
    assert.equal(normalizeParserRecovery(result, true, "parity"), result);
  }
});

test("syntax recovery requires an error exit and a syntax diagnostic", () => {
  for (const result of [
    { ...recovered, status: 0 },
    { ...recovered, status: null },
    { ...recovered, stdout: recovered.stdout.replace("TS1260", "TS2322") },
  ]) {
    assert.equal(normalizeParserRecovery(result, true, "parity"), result);
  }
});

test("recovery does not relax report consistency checks", () => {
  const result = normalizeParserRecovery(
    { ...recovered, stdout: recovered.stdout.replace('"errorCount":2', '"errorCount":1') },
    true,
    "parity",
  );
  assert.throws(
    () => normalizeTypecheckResult(result, process.cwd(), "json"),
    /count does not match/u,
  );
});
