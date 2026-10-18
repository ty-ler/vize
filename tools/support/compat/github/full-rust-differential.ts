import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isEntrypoint } from "../../command-runtime.ts";
import { aggregateNeedsResults } from "./require-needs-success.ts";
import { fullDifferentialMatrix, fullDifferentialSteps } from "./rust-differential-lanes.ts";

export const fullDifferentialProducers = [
  "full-rust-differential",
  "full-native-navigation",
  "full-native-ssr",
] as const;

export function fullDifferentialRoles() {
  return [...fullDifferentialMatrix().lane, "native-navigation", "native-ssr"];
}

function producer(role: string) {
  assert.ok(fullDifferentialRoles().includes(role), "unknown full differential role");
  return role === "native-navigation"
    ? "full-native-navigation"
    : role === "native-ssr"
      ? "full-native-ssr"
      : "full-rust-differential";
}

function recipe(role: string) {
  if (role === "native-navigation" || role === "native-ssr") {
    const action = `.github/actions/test-${role}/action.yml`;
    return { action, sha256: createHash("sha256").update(readFileSync(action)).digest("hex") };
  }
  // Receipt transport is JSON: absent optional env fields must compare exactly
  // after upload/download as well as in the in-memory producer.
  return JSON.parse(JSON.stringify(fullDifferentialSteps(role))) as unknown;
}

type Identity = {
  sourceSha: string;
  runId: string;
  attempt: number;
  event: string;
};
type Receipt = Identity & {
  schema: "vize.full-rust-differential";
  role: string;
  producer: string;
  status: string;
  recipe: unknown;
  runtime: { requireTsgo: "1"; nuxtIterations: "100" };
};

function identity(env: NodeJS.ProcessEnv): Identity {
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u);
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9]\d*$/u);
  assert.match(env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9]\d*$/u);
  assert.ok(["schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME ?? ""));
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  assert.ok(Number.isSafeInteger(attempt));
  return {
    sourceSha: env.GITHUB_SHA!,
    runId: env.GITHUB_RUN_ID!,
    attempt,
    event: env.GITHUB_EVENT_NAME!,
  };
}

function expectedReceipt(
  role: string,
  status: string,
  env: NodeJS.ProcessEnv,
  attempt: number,
): Receipt {
  return {
    schema: "vize.full-rust-differential",
    ...identity(env),
    attempt,
    role,
    producer: producer(role),
    status,
    recipe: recipe(role),
    runtime: { requireTsgo: "1", nuxtIterations: "100" },
  };
}

export function createFullDifferentialReceipt(
  role: string,
  status: string,
  env: NodeJS.ProcessEnv = process.env,
): Receipt {
  assert.equal(env.GITHUB_JOB, producer(role), "wrong full differential producer");
  assert.equal(env.VIZE_TEST_REQUIRE_TSGO, "1");
  assert.equal(env.VIZE_NUXT_CONFIG_ITERATIONS, "100");
  assert.equal(env.VIZE_TEST_DISABLE_TSGO, undefined);
  assert.ok(["success", "failure", "cancelled", "skipped"].includes(status));
  return expectedReceipt(role, status, env, identity(env).attempt);
}

/** Missing matrix legs cannot be hidden by a successful aggregate result. */
export function verifyFullDifferentialReceipts(
  rows: unknown[],
  needs: unknown,
  env: NodeJS.ProcessEnv = process.env,
  producerAttempts?: Record<string, number>,
) {
  assert.ok(needs && typeof needs === "object" && !Array.isArray(needs));
  assert.deepEqual(Object.keys(needs).sort(), [...fullDifferentialProducers].sort());
  assert.equal(aggregateNeedsResults(needs).exitCode, 0, "every producer must succeed");
  const expected = fullDifferentialRoles();
  assert.equal(new Set(expected).size, expected.length);
  assert.equal(rows.length, expected.length, "complete full differential role inventory required");
  const attempts =
    producerAttempts ?? Object.fromEntries(expected.map((role) => [role, identity(env).attempt]));
  assert.deepEqual(Object.keys(attempts).sort(), [...expected].sort());
  const actual = new Map<string, unknown>();
  for (const row of rows) {
    assert.ok(row && typeof row === "object" && !Array.isArray(row));
    const role: unknown = Reflect.get(row, "role");
    assert.ok(typeof role === "string");
    assert.ok(expected.includes(role), "unexpected full differential role");
    assert.ok(!actual.has(role), "duplicate full differential role");
    actual.set(role, row);
  }
  for (const role of expected) {
    const attempt = attempts[role];
    assert.ok(Number.isSafeInteger(attempt) && attempt > 0 && attempt <= identity(env).attempt);
    const wanted = expectedReceipt(role, "success", env, attempt);
    assert.deepEqual(actual.get(role), wanted, `full differential receipt changed: ${role}`);
  }
}

export function readFullDifferentialReceipts(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const source = identity(env);
  const prefix = `full-rust-differential-${source.runId}-`;
  const roles = fullDifferentialRoles();
  const artifacts = readdirSync(directory, { withFileTypes: true });
  const selected = new Map<string, { attempt: number; row: unknown }>();
  for (const entry of artifacts) {
    assert.ok(entry.isDirectory(), "artifact directory must not be a symlink");
    assert.ok(entry.name.startsWith(prefix), "foreign full differential run");
    const remainder = entry.name.slice(prefix.length),
      boundary = `-${source.sourceSha}-`;
    const split = remainder.indexOf(boundary);
    assert.ok(split > 0, "foreign full differential source");
    const rawAttempt = remainder.slice(0, split),
      role = remainder.slice(split + boundary.length);
    assert.match(rawAttempt, /^[1-9]\d*$/u);
    const attempt = Number(rawAttempt);
    assert.ok(
      Number.isSafeInteger(attempt) && attempt <= source.attempt,
      "future producer attempt",
    );
    assert.ok(roles.includes(role), "unexpected full differential artifact role");
    assert.equal(entry.name, `${prefix}${attempt}-${source.sourceSha}-${role}`);
    const files = readdirSync(path.join(directory, entry.name), { withFileTypes: true });
    assert.equal(files.length, 1);
    assert.ok(
      files[0].isFile() && files[0].name === `${role}.json`,
      "one regular role receipt required",
    );
    const row = JSON.parse(
      readFileSync(path.join(directory, entry.name, files[0].name), "utf8"),
    ) as Receipt;
    assert.ok(["success", "failure", "cancelled", "skipped"].includes(row.status));
    assert.deepEqual(row, expectedReceipt(role, row.status, env, attempt));
    const previous = selected.get(role);
    assert.ok(previous?.attempt !== attempt, "duplicate producer attempt");
    if (!previous || attempt > previous.attempt) selected.set(role, { attempt, row });
  }
  assert.deepEqual(
    [...selected.keys()].sort(),
    [...roles].sort(),
    "missing full differential role",
  );
  // Like the workspace producerAttempt output, a failed-job rerun may retain
  // completed roles from this SAME run/source. The latest artifact wins, so a
  // newer failed attempt can never fall back to an older successful receipt.
  return {
    rows: roles.map((role) => selected.get(role)!.row),
    producerAttempts: Object.fromEntries(roles.map((role) => [role, selected.get(role)!.attempt])),
  };
}

if (isEntrypoint(import.meta.url)) {
  const [command, first, second, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0);
  if (command === "matrix") {
    assert.equal(first, undefined);
    console.log(`matrix=${JSON.stringify(fullDifferentialMatrix())}`);
  } else {
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      process.env.GITHUB_SHA,
      "full differential source checkout changed",
    );
    if (command === "record") {
      assert.ok(first && second);
      const receipt = createFullDifferentialReceipt(first, second);
      assert.ok(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP));
      const directory = path.join(process.env.RUNNER_TEMP, "full-rust-differential");
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, `${first}.json`), JSON.stringify(receipt) + "\n", {
        flag: "wx",
      });
    } else {
      assert.equal(command, "verify");
      assert.ok(first);
      assert.equal(second, undefined);
      const { rows, producerAttempts } = readFullDifferentialReceipts(first);
      verifyFullDifferentialReceipts(
        rows,
        JSON.parse(process.env.NEEDS_JSON ?? "null"),
        process.env,
        producerAttempts,
      );
    }
  }
}
