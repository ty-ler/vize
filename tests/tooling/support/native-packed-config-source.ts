/** Whole historical Git source custody with an explicit finite compiler-role partition. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// These exact reviewed tool sources are not primary compiler source inputs.
// Any role change requires a new finite source review, not a rehashed packet.
export const SOURCE_ONLY_RUST_NAMES = [
  "tools/commands/ci/github/release-preflight.rs",
  "tools/commands/ci/source-file-lengths.rs",
  "tools/commands/fixtures/lint-divergence-report.rs",
  "tools/commands/fixtures/typecheck-divergence-report.rs",
  "tools/commands/release/pr.rs",
  "tools/support/lint_divergence_surface.rs",
  "tools/support/release/pr_ci.rs",
  "tools/support/release/pr_pin.rs",
  "tools/support/release/pr_pin_body.rs",
  "tools/support/release/pr_pin_body_observed_tests.rs",
  "tools/support/release/pr_pin_body_tests.rs",
  "tools/support/release/pr_pin_budget_tests.rs",
  "tools/support/release/pr_pin_candidate.rs",
  "tools/support/release/pr_pin_integration.rs",
  "tools/support/release/pr_pin_lock.rs",
  "tools/support/release/pr_pin_lock_tests.rs",
  "tools/support/release/pr_pin_metadata.rs",
  "tools/support/release/pr_pin_process.rs",
  "tools/support/release/pr_pin_process_tests.rs",
  "tools/support/release/pr_pin_queue.rs",
  "tools/support/release/pr_pin_queue_tests.rs",
  "tools/support/release/pr_pin_retire.rs",
  "tools/support/release/pr_pin_retire_archive.rs",
  "tools/support/release/pr_pin_retire_evidence.rs",
  "tools/support/release/pr_pin_retire_guard.rs",
  "tools/support/release/pr_pin_retire_ledger.rs",
  "tools/support/release/pr_pin_retire_lifecycle_tests.rs",
  "tools/support/release/pr_pin_retire_prequalification_archive_tests.rs",
  "tools/support/release/pr_pin_retire_source.rs",
  "tools/support/release/pr_pin_rollback.rs",
  "tools/support/release/pr_pin_rollback_tests.rs",
  "tools/support/release/pr_pin_runs.rs",
  "tools/support/release/pr_pin_start.rs",
  "tools/support/release/pr_pin_target_tests.rs",
  "tools/support/release/pr_pin_tests.rs",
  "tools/support/release/pr_pin_watch.rs",
  "tools/support/release/pr_pin_watch_tests.rs",
  "tools/support/release/pr_promote.rs",
  "tools/support/release/pr_tests.rs",
  "tools/support/release/pr_watch.rs",
  "tools/support/release/preflight_job_evidence.rs",
  "tools/support/release/preflight_pinned_evidence_tests.rs",
  "tools/support/typecheck_baseline_usability.rs",
  "tools/support/typecheck_mutation_recovery.rs",
  "tools/support/typecheck_process_session.rs",
  "tools/support/typecheck_project_deadline.rs",
] as const;

export interface Extension {
  schema: string;
  beforeSha256: string;
  afterSha256: string;
  hunks: { before: string; after: string }[];
  producer: {
    head: string;
    files: Record<string, string | null>;
    absentFiles: string[];
    retiredRust: { path: string; sha256: string };
    sourceOnlyRust: { path: string; sha256: string };
    composedBase: string;
    historicalRenames: { from: string }[];
    previousComposition: {
      source: string;
      producer: string;
      witnessSha256: string;
      sourceOnlySha256: string;
      workflowSha256: string;
    };
  };
}
interface Retirement {
  schema: string;
  source: string;
  retiredAt: string;
  files: Record<string, string>;
}
interface SourceIdentity {
  mode: string;
  blob: string;
  sha256: string;
}
export interface SourceOnlyRust {
  schema: string;
  producer: string;
  priorSource: string;
  main: string;
  files: Record<
    string,
    {
      compilerBound: false;
      prior: SourceIdentity | null;
      current: SourceIdentity | null;
      main: SourceIdentity | null;
      retiredAt: string | null;
    }
  >;
}
/** One immutable reference view per call; no filesystem or cross-invocation cache. */
export function readPackedSourceIdentities(
  repository: string,
  ref: string,
  files: readonly string[],
): Map<string, SourceIdentity | null> {
  assert.match(ref, /^[0-9a-f]{40}$/u);
  assert.ok(files.length > 0, "at least one exact source path is required");
  assert.equal(new Set(files).size, files.length, "source paths are unique");
  for (const file of files)
    assert.ok(
      file
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".." && !/[\\\0]/u.test(part)),
    );
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, { cwd: repository, input, maxBuffer: 64 * 1024 * 1024 });
  const tree = git(["ls-tree", "-rz", ref, "--", ...files]);
  assert.deepEqual(Buffer.from(tree.toString("utf8")), tree, "literal UTF-8 source paths");
  assert.ok(tree.length === 0 || tree.at(-1) === 0, "complete tree framing");
  const rows = tree
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755|120000) blob ([0-9a-f]{40})\t([\s\S]+)$/u.exec(entry);
      assert.ok(match && files.includes(match[3]), "exact requested blob path and mode");
      return { mode: match[1], blob: match[2], file: match[3] };
    });
  assert.equal(new Set(rows.map((row) => row.file)).size, rows.length, "one tree entry per path");
  const result = new Map<string, SourceIdentity | null>(files.map((file) => [file, null]));
  if (rows.length === 0) return result;
  const raw = git(["cat-file", "--batch"], rows.map((row) => row.blob).join("\n") + "\n");
  let offset = 0;
  for (const row of rows) {
    const end = raw.indexOf(10, offset);
    assert.ok(end > offset, "complete batch header");
    const headerBytes = raw.subarray(offset, end);
    const headerText = headerBytes.toString("ascii");
    assert.deepEqual(Buffer.from(headerText, "ascii"), headerBytes, "literal ASCII batch header");
    const header = /^([0-9a-f]{40}) blob (0|[1-9][0-9]*)$/u.exec(headerText);
    assert.ok(header && header[1] === row.blob, "batch binds exact tree object");
    const size = Number(header[2]);
    assert.ok(Number.isSafeInteger(size) && end + 1 + size < raw.length, "complete batch body");
    const bytes = raw.subarray(end + 1, end + 1 + size);
    assert.equal(
      createHash("sha1").update(`blob ${size}\0`).update(bytes).digest("hex"),
      row.blob,
      "whole Git blob identity",
    );
    offset = end + 1 + size;
    assert.equal(raw[offset++], 10, "complete batch terminator");
    result.set(row.file, {
      mode: row.mode,
      blob: row.blob,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  assert.equal(offset, raw.length, "no extra batch records or bytes");
  return result;
}

export function readPackedProducerRetirement(
  repository: string,
  producer: Extension["producer"],
): Retirement {
  const bytes = fs.readFileSync(path.join(repository, producer.retiredRust.path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), producer.retiredRust.sha256);
  const retirement = JSON.parse(bytes.toString()) as Retirement;
  assert.equal(retirement.schema, "vize.packed-config-retired-rust.v1");
  return retirement;
}

/** Exact finite tooling roles are source custody, never compiler-source claims. */
export function verifySourceOnlyRust(
  repository: string,
  producer: Extension["producer"],
  selected: string,
): {
  sourceOnlyFiles: Record<string, string | null>;
  compilerFiles: Record<string, string | null>;
} {
  const bytes = fs.readFileSync(path.join(repository, producer.sourceOnlyRust.path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), producer.sourceOnlyRust.sha256);
  const roles = JSON.parse(bytes.toString()) as SourceOnlyRust;
  assert.equal(roles.schema, "vize.packed-config-source-only-rust.v1");
  assert.equal(roles.producer, producer.head);
  for (const ref of [roles.producer, roles.priorSource, roles.main, selected])
    assert.match(ref, /^[0-9a-f]{40}$/u);
  const names = Object.keys(roles.files);
  assert.deepEqual(
    [...names].sort(),
    [...SOURCE_ONLY_RUST_NAMES],
    "exact independently reviewed source-only roles",
  );
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository });
  for (const ancestor of [roles.priorSource, roles.main])
    git("merge-base", "--is-ancestor", ancestor, producer.head);
  const views = new Map<string, Map<string, SourceIdentity | null>>();
  const identity = (ref: string, file: string): SourceIdentity | null => {
    if (!views.has(ref)) views.set(ref, readPackedSourceIdentities(repository, ref, names));
    const value = views.get(ref)?.get(file);
    assert.notEqual(value, undefined, "every requested path has an explicit identity or absence");
    return value ?? null;
  };
  for (const [file, row] of Object.entries(roles.files)) {
    assert.equal(row.compilerBound, false, file);
    assert.deepEqual(identity(roles.priorSource, file), row.prior, file);
    assert.deepEqual(identity(roles.main, file), row.main, file);
    assert.deepEqual(identity(producer.head, file), row.current, file);
    assert.deepEqual(identity(selected, file), row.current, file);
    const physical = fs.lstatSync(path.join(repository, file), { throwIfNoEntry: false });
    if (row.current === null) assert.equal(physical, undefined, file);
    else {
      assert.ok(physical?.isFile(), file);
      assert.equal(
        createHash("sha256")
          .update(fs.readFileSync(path.join(repository, file)))
          .digest("hex"),
        row.current.sha256,
        file,
      );
    }
    if (row.retiredAt !== null) {
      assert.match(row.retiredAt, /^[0-9a-f]{40}$/u);
      git("merge-base", "--is-ancestor", row.retiredAt, roles.main);
      assert.equal(identity(row.retiredAt, file), null, file);
      assert.notEqual(row.prior, null, file);
      assert.equal(row.current, null, file);
    }
  }
  const sourceOnlyFiles = Object.fromEntries(
    names.map((file) => [file, roles.files[file].current?.sha256 ?? null]),
  );
  const compilerFiles = Object.fromEntries(
    Object.entries(producer.files).filter(([file]) => !names.includes(file)),
  );
  const renamed = producer.historicalRenames.map((row) => row.from);
  const compiledRust = Object.keys(compilerFiles).filter(
    (file) => file.endsWith(".rs") && !renamed.includes(file),
  );
  const changedRust = git(
    "diff",
    "--name-only",
    "--no-renames",
    producer.composedBase,
    producer.head,
    "--",
    "*.rs",
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(
    [...compiledRust, ...names].sort(),
    changedRust.sort(),
    "every Rust delta has exactly one finite role",
  );
  git("diff", "--exit-code", producer.head, selected, "--", "*.rs");
  return { sourceOnlyFiles, compilerFiles };
}

/** Historical custody survives later product changes; current equality belongs to the selected preflight. */
export function verifyHistoricalProducerFiles(
  repository: string,
  producer: Extension["producer"],
): Record<string, string | null> {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository });
  const retirement = readPackedProducerRetirement(repository, producer);
  const absentFiles = [...producer.absentFiles, ...Object.keys(retirement.files)];
  assert.equal(new Set(absentFiles).size, absentFiles.length);
  assert.deepEqual(
    [...absentFiles].sort(),
    Object.keys(producer.files)
      .filter((file) => producer.files[file] === null)
      .sort(),
  );
  git("merge-base", "--is-ancestor", retirement.source, "HEAD");
  git("merge-base", "--is-ancestor", retirement.retiredAt, producer.head);
  const requested = new Map<string, Set<string>>();
  for (const [ref, names] of [
    [retirement.source, Object.keys(retirement.files)],
    [retirement.retiredAt, Object.keys(retirement.files)],
    [producer.head, Object.keys(producer.files)],
  ] as const) {
    const namesForRef = requested.get(ref) ?? new Set<string>();
    for (const file of names) namesForRef.add(file);
    requested.set(ref, namesForRef);
  }
  const views = new Map(
    [...requested].map(([ref, names]) => [
      ref,
      readPackedSourceIdentities(repository, ref, [...names]),
    ]),
  );
  const identity = (ref: string, file: string) => {
    const value = views.get(ref)?.get(file);
    assert.notEqual(value, undefined, "explicit observed path required");
    return value ?? null;
  };
  for (const [file, expected] of Object.entries(retirement.files)) {
    assert.equal(identity(retirement.source, file)?.sha256, expected, file);
    assert.equal(identity(retirement.retiredAt, file), null, file);
  }
  const observed: Record<string, string | null> = {};
  for (const [file, expected] of Object.entries(producer.files)) {
    const actual = identity(producer.head, file);
    if (absentFiles.includes(file)) {
      assert.equal(expected, null, file);
      assert.equal(actual, null, file);
    } else {
      assert.match(expected ?? "", /^[0-9a-f]{64}$/u);
      assert.equal(actual?.sha256, expected, file);
    }
    observed[file] = actual?.sha256 ?? null;
  }
  return observed;
}

/** Exact reviewed embedded inputs, distinguishing Cargo tests from production consumers. */
export function verifyPackedCompileTimeInputs(producer: {
  additionalCompileTimeInputs: unknown;
  mainCompileTimeInputBase: unknown;
  mainCompileTimeInputs: unknown;
}): void {
  assert.deepEqual(producer.additionalCompileTimeInputs, [
    {
      path: "crates/vize/src/commands/inspector/official_compiler.ts",
      source: "crates/vize/src/commands/inspector/compare.rs",
      role: "production-cli-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/content-mapper/escaton-nested-flow-9433.json",
      source: "crates/vize_canon/src/virtual_ts/tests/vif_chain.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/linter/computed-suppression-reka/NavigationMenuContentImpl.vue.fixture",
      source: "crates/vize_patina/tests/computed_suppression_history.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lsp/component-native-events/checked-native.expected.json",
      source: "crates/vize/tests/support/event_completion_project.rs",
      role: "cargo-test-embedded",
      incomingChanged: false,
    },
  ]);
  assert.equal(producer.mainCompileTimeInputBase, "7e1cdefb1f0c97243a26fd8f332386bbf299ed07");
  assert.deepEqual(producer.mainCompileTimeInputs, [
    {
      path: "tests/_fixtures/content-mapper/with-defaults-surplus.json",
      source: "crates/vize/tests/content_mapper_tsgo_cli.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/content-mapper/with-defaults-surplus.json",
      source: "crates/vize_canon/tests/with_defaults_surplus.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "crates/vize_canon/src/virtual_ts/component_prop_helpers.txt",
      source: "crates/vize/tests/support/event_completion_witness.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lsp/component-native-events/public-input-prelude-before-9498.txt",
      source: "crates/vize/tests/support/event_completion_witness.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "crates/vize_armature/tests/_fixtures/empty_attribute_value_witness.bin",
      source: "crates/vize_armature/src/parser/tokenizer_empty_value_witness.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "crates/vize_armature/tests/_fixtures/tokenizer_parser_fixtures.bin",
      source: "crates/vize_armature/src/parser/tokenizer_empty_value_witness.rs",
      role: "cargo-test-embedded",
      incomingChanged: false,
    },
    {
      path: "tests/_fixtures/content-mapper/escaton-public-props-9498.json",
      source: "crates/vize_canon/tests/public_component_input_props.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "crates/vize_canon/tests/fixtures/projection-carriers-svg-9200.json",
      source: "crates/vize_canon/tests/support/projection_carriers.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lsp/lint-hover-severity/responses.authored.json",
      source: "crates/vize_maestro/src/server/handlers/tests/requests/responses.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lsp/lint-hover-severity/App.vue.txt",
      source: "crates/vize_maestro/src/server/handlers/tests/requests/responses.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "crates/vize_maestro/tests/fixtures/split_script_checker.virtual.ts.txt",
      source: "crates/vize_maestro/tests/split_script_checker.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lint/native-svg-content/cases.json",
      source: "crates/vize_patina/tests/v_html_on_unknown_lowercase_components.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lint/native-svg-content/FacetBarChart.vue",
      source: "crates/vize_patina/tests/v_html_on_unknown_lowercase_components.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "tests/_fixtures/differential/lint/native-svg-content/TimelineChartDepSizeSvgSlot.vue",
      source: "crates/vize_patina/tests/v_html_on_unknown_lowercase_components.rs",
      role: "cargo-test-embedded",
      incomingChanged: true,
    },
    {
      path: "crates/vize_canon/src/virtual_ts/component_prop_helpers.txt",
      source: "crates/vize_canon/src/virtual_ts/helpers/preamble.rs",
      role: "production-canon-embedded",
      incomingChanged: true,
    },
  ]);
}
