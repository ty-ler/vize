import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  loadProjectionMatrix,
  validateProjectionMatrix,
  verifyProjectionDigest,
  type ProjectionDigest,
} from "./support/davinci-ts40-projection.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("TS-40 current-projection fixture matrix is explicit and non-vacuous", () => {
  const matrix = loadProjectionMatrix(root);
  validateProjectionMatrix(root, matrix);
  assert.ok(matrix.fixtures.length >= 10, "TS-40 matrix must contain at least 10 fixtures");
  assert.ok(
    matrix.unproven.some((item) => item.includes("Davinci or L2")),
    "TS-40 matrix must explicitly leave Davinci or L2 parity unproven",
  );
  assert.ok(
    matrix.normalization.some((item) => item.includes("preserve generation order")),
    "TS-40 normalization must explicitly preserve generation order",
  );
});

test("TS-40 matrix reports the fixture id when a source fixture is missing", () => {
  const matrix = loadProjectionMatrix(root);
  const fixture = matrix.fixtures[0];
  assert.ok(fixture, "TS-40 matrix must contain a fixture for the missing-source oracle");
  const missingFile = "tests/_fixtures/davinci-ts40-projection/missing.vue";

  assert.throws(
    () =>
      validateProjectionMatrix(root, {
        ...matrix,
        fixtures: [{ ...fixture, file: missingFile }, ...matrix.fixtures.slice(1)],
      }),
    {
      name: "Error",
      message: `${fixture.id} source fixture is missing: ${missingFile}`,
    },
  );
});

test("TS-40 verifier fails closed on mapping drift", () => {
  const baseline = digest();
  assert.throws(
    () => verifyProjectionDigest(baseline, { ...baseline, mappingsSha256: "f".repeat(64) }),
    /TS-40 mapping drift/,
  );
});

test("TS-40 verifier fails closed on diagnostic drift", () => {
  const baseline = digest();
  assert.throws(
    () => verifyProjectionDigest(baseline, { ...baseline, diagnosticsSha256: "f".repeat(64) }),
    /TS-40 diagnostic drift/,
  );
});

test("TS-40 baselines are wired into exact Content Mapper CI", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/content-mapper-conformance.yml"),
    "utf8",
  );
  const parsed = parse(workflow) as {
    on: {
      schedule?: Array<{ cron: string }>;
      workflow_dispatch?: unknown;
    };
    env?: { CONTENT_MAPPER_TYPESCRIPT_SHA?: string };
    jobs?: {
      "exact-tsgo-project"?: {
        steps?: Array<{
          name?: string;
          run?: string;
          with?: { repository?: string; ref?: string };
        }>;
      };
    };
  };
  assert.deepEqual(Object.keys(parsed.on).toSorted(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(parsed.on.schedule, [{ cron: "21 4 * * *" }]);
  assert.equal(
    parsed.env?.CONTENT_MAPPER_TYPESCRIPT_SHA,
    "d6c4afddb2c55f4a9dea7b59293a99a8fdea1799",
  );

  const steps = parsed.jobs?.["exact-tsgo-project"]?.steps ?? [];
  const upstreamCheckout = steps.filter(
    (step) => step.name === "Checkout exact TypeScript Content Mapper revision",
  );
  assert.equal(upstreamCheckout.length, 1, "exact upstream checkout must run once");
  assert.equal(upstreamCheckout[0].with?.repository, "microsoft/TypeScript");
  assert.equal(upstreamCheckout[0].with?.ref, "${{ env.CONTENT_MAPPER_TYPESCRIPT_SHA }}");

  const baselineSteps = steps.filter(
    (step) => step.name === "Run TS-40 current-projection baselines",
  );
  assert.equal(baselineSteps.length, 1, "TS-40 baselines must run once in exact conformance");
  assert.deepEqual(
    baselineSteps[0].run
      ?.trim()
      .split("\n")
      .map((line) => line.trim()),
    [
      "cargo test -p vize --test davinci_ts40_projection_cli -- --nocapture",
      "cargo test -p vize_maestro --test davinci_ts40_projection -- --nocapture",
      'VIZE_TEMPLATE_EMIT_TS40_CAPTURE="$RUNNER_TEMP/content-mapper-smoke/ts40-legacy" cargo test -p vize_maestro --features legacy --test davinci_ts40_projection -- --nocapture',
      "node --test tests/tooling/davinci-ts40-projection.test.ts tests/tooling/content-mapper-manifest.test.ts",
    ],
  );
});

function digest(): ProjectionDigest {
  return {
    diagnosticsSha256: "d".repeat(64),
    mappingsSha256: "a".repeat(64),
  };
}

test("exact Content Mapper stress retains provider and whole native streams before strict failure upload", () => {
  const workflow = parse(
    fs.readFileSync(path.join(root, ".github/workflows/content-mapper-conformance.yml"), "utf8"),
  ) as {
    jobs: Record<
      string,
      {
        steps: Array<{
          name?: string;
          run?: string;
          env?: Record<string, string>;
          if?: string;
          uses?: string;
        }>;
      }
    >;
  };
  const steps = workflow.jobs["exact-tsgo-project"].steps;
  const named = (name: string) => {
    const matches = steps.filter((step) => step.name === name);
    assert.equal(matches.length, 1);
    return matches[0];
  };
  const provider = named("Preserve exact editor provider");
  const stress = named("Stress exact editor lifecycle");
  const capture = named("Preserve exact editor lifecycle streams");
  const upload = named("Preserve installed Content Mapper smoke evidence");
  assert.deepEqual(stress.env, {
    TSGO_PATH: "${{ runner.temp }}/tsgo",
    VIZE_TEST_CONTENT_MAPPER_TSGO: "${{ runner.temp }}/tsgo",
    NEXTEST_PROFILE: "full",
  });
  assert.deepEqual(stress.run?.trim().split("\n"), [
    "for iteration in $(seq 1 20); do",
    "  cargo test -p vize_maestro -- --quiet",
    '  echo "Content Mapper Maestro lifecycle cycle $iteration/20 passed"',
    "done",
  ]);
  assert.deepEqual(provider.run?.trim().split("\n"), [
    'evidence="$RUNNER_TEMP/content-mapper-smoke/native-editor"',
    'mkdir -p "$evidence"',
    'cp "$RUNNER_TEMP/tsgo" "$evidence/tsgo"',
    'sha256sum "$RUNNER_TEMP/tsgo" "$evidence/tsgo" > "$evidence/provider.sha256"',
    'go version -m "$evidence/tsgo" > "$evidence/go-build-info.txt"',
  ]);
  assert.equal(capture.if, "always()");
  assert.deepEqual(capture.run?.trim().split("\n"), [
    'evidence="$RUNNER_TEMP/content-mapper-smoke/native-editor"',
    'mkdir -p "$evidence"',
    "if [ -d target/nextest/full/native-proxy-termination ]; then",
    '  cp -R target/nextest/full/native-proxy-termination "$evidence/"',
    "fi",
  ]);
  assert.equal(upload.if, "always()");
  assert.deepEqual(
    [provider, stress, capture, upload].map((step) => steps.indexOf(step)),
    [
      steps.indexOf(stress) - 1,
      steps.indexOf(stress),
      steps.indexOf(stress) + 1,
      steps.indexOf(stress) + 2,
    ],
  );
});

test("native EOF observer admits only each complete authenticated provider and initialization pair", () => {
  const fixtures = path.join(root, "crates/vize_maestro/tests/fixtures");
  const oldContract = JSON.parse(
    fs.readFileSync(path.join(fixtures, "native-proxy-initialize.json"), "utf8"),
  ) as Record<string, unknown>;
  const currentContract = {
    ...oldContract,
    serverInfo: { name: "typescript", version: "7.1.0-dev" },
  };
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      );
    }
    return value;
  };
  // Whole actual d6c initialization from run 39124809180, not a reduced capability vector.
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(canonical(currentContract)))
      .digest("hex"),
    "88c1fd90c52b92e6f30cbeddc40efec0438bdaa2884b97283986ec9e6be82c4f",
  );
  const digests = [
    "4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4",
    "a82f731365ad69d5c4c15f5e18fba4584bf3b7b839960172a76c3462b5114bf2",
    "77dd575e73107c00cc95cbccc3764ab7210089b5634f75e219b61632bd5d230b",
    "0".repeat(64),
  ];
  type Row = {
    digest: string;
    result: unknown;
    initialized: number;
    acknowledged?: number;
    translated?: number;
    ack?: unknown;
    exit?: unknown;
  };
  const rows: Row[] = [];
  for (const [index, digest] of digests.entries()) {
    for (const [profile, result] of [oldContract, currentContract].entries()) {
      rows.push({
        digest,
        result,
        initialized: Number(index === 2 ? profile === 1 : index < 2 && profile === 0),
      });
    }
  }
  const replaceAt = (
    value: unknown,
    route: string[],
    replacement: unknown,
    remove: boolean,
  ): unknown => {
    if (route.length === 0) return replacement;
    const copy = structuredClone(value) as Record<string, unknown>;
    let parent = copy;
    for (const key of route.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    const key = route.at(-1)!;
    if (remove) delete parent[key];
    else parent[key] = replacement;
    return copy;
  };
  const collect = (value: unknown, route: string[] = []): string[][] => [
    route,
    ...(value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, item]) => collect(item, [...route, key]))
      : []),
  ];
  for (const [profile, contract] of [oldContract, currentContract].entries()) {
    const digest = digests[profile === 0 ? 0 : 2];
    const routes = collect(contract);
    assert.ok(routes.length > 80);
    for (const route of routes) {
      rows.push({ digest, result: replaceAt(contract, route, null, false), initialized: 0 });
      if (route.length)
        rows.push({ digest, result: replaceAt(contract, route, null, true), initialized: 0 });
    }
    rows.push({ digest, result: { ...contract, extra: true }, initialized: 0 });
    for (const ack of [
      { jsonrpc: "2.0", id: "12", result: null },
      { jsonrpc: "2.0", id: 12, result: false },
      { jsonrpc: "2.0", id: 12, error: { code: -1, message: "whole refusal" } },
    ])
      rows.push({ digest, result: contract, initialized: 1, acknowledged: 0, translated: 0, ack });
    rows.push({
      digest,
      result: contract,
      initialized: 1,
      translated: 0,
      exit: { jsonrpc: "2.0", method: "exit", params: null },
    });
  }
  const harness = String.raw`use strict;
use warnings;
use JSON::PP;
my ($fixture, $contract) = @ARGV;
require $fixture;
my $json = JSON::PP->new->utf8->canonical;
my $rows = $json->decode(do { local $/; <STDIN> });
my @out;
sub frame { my $body = $json->encode($_[0]); return 'Content-Length: '.length($body)."\r\n\r\n".$body; }
for my $row (@$rows) {
    no warnings qw(redefine once);
    local *NativeProxyLifecycle::file_identity = sub { return { sha256 => $row->{digest}, stat => [1] }; };
    local *NativeProxyLifecycle::process_identity = sub { return { pid => 71, birth => 91 }; };
    my $p = NativeProxyLifecycle->new('/explicit-synthetic-image-seam', $contract);
    for my $pair (
        ['client', { jsonrpc => '2.0', id => 11, method => 'initialize', params => {} }],
        ['server', { jsonrpc => '2.0', id => 11, result => $row->{result} }],
        ['client', { jsonrpc => '2.0', id => 12, method => 'shutdown' }],
        ['server', $row->{ack} // { jsonrpc => '2.0', id => 12, result => undef }],
        ['client', $row->{exit} // { jsonrpc => '2.0', method => 'exit' }],
    ) {
        for my $f ($p->frames($pair->[0], frame($pair->[1]))) {
            $pair->[0] eq 'client' ? $p->client(@$f, 71) : $p->server($f->[1], 71);
        }
    }
    push @out, { candidate => $p->{candidate}, expected => $p->{expected},
        initialized => $p->{initialized} // 0, acknowledged => $p->{acknowledged} // 0,
        translated => $p->{translated}, errors => $p->{errors} };
}
print $json->encode(\@out);
`;
  const output = spawnSync(
    "perl",
    [
      "-e",
      harness,
      path.join(fixtures, "native-proxy-lifecycle.pl"),
      path.join(fixtures, "native-proxy-initialize.json"),
    ],
    {
      input: JSON.stringify(rows),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.signal, null);
  assert.equal(output.stderr, "");
  const actual = JSON.parse(output.stdout) as unknown[];
  assert.equal(actual.length, rows.length);
  assert.deepEqual(
    actual,
    rows.map((row) => {
      const known = row.digest !== digests[3];
      return {
        candidate: Number(known),
        expected: known ? (row.digest === digests[2] ? currentContract : oldContract) : null,
        initialized: row.initialized,
        acknowledged: known ? (row.acknowledged ?? 1) : 0,
        translated: row.translated ?? row.initialized,
        errors: [],
      };
    }),
  );
});
