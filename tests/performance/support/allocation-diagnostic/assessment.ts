import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodeFrames } from "../../../differential/lsp-wire.ts";
import { sha256 } from "../../../differential/sha256.ts";
import { FROZEN_SOURCE } from "./launch.ts";
import { originalClientVector, originalServerVector } from "./wire.ts";
import { assessPacketCustody } from "./packets.ts";

export const COUNTERS = [
  "alloc_calls",
  "alloc_zeroed_calls",
  "alloc_failures",
  "alloc_zeroed_failures",
  "alloc_bytes",
  "alloc_zeroed_bytes",
  "dealloc_calls",
  "dealloc_bytes",
  "realloc_calls",
  "realloc_failures",
  "realloc_old_bytes",
  "realloc_new_bytes",
] as const;

const ORIGINAL_BUDGET = {
  scale: 1,
  suite: "misskey-lsp-churn",
  cyclesPerPhase: 20,
  hardTimeoutMs: 60000,
  budgetsMs: {
    initialize: 1000,
    coldOpen: 8000,
    cycle: 9000,
    fileLifecycle: 9000,
    phaseFence: 1500,
    cancellationConverge: 6000,
    closeClear: 3000,
  },
  maxPeakRssMiB: 128,
  maxPeakProcessTreeRssMiB: 384,
  maxProcessTreeSize: 3,
  maxTailToHeadLatencyRatio: 3,
};
const ORIGINAL_LABELS = [
  "coldOpen",
  ...["A", "B"].flatMap((phase) => Array.from({ length: 20 }, (_, i) => `${phase}${i}`)),
  "cancellation",
  "closed",
  ...Array.from({ length: 20 }, (_, i) => `file-lifecycle-${i}`),
];

const integer = (line: string, field: string): bigint => {
  const matched = line.match(new RegExp(`(?:^| )${field}=(\\d+)(?: |$)`));
  assert(matched, `complete numeric field required: ${field}`);
  return BigInt(matched[1]);
};

/** Reject resets and missing complete packets; overlapping global windows are not causal costs. */
export function allocationWindows(stderr: string, ownerPid: number) {
  const lines = stderr.split("\n");
  const begin = lines.filter((line) => line.startsWith("vize_lsp_allocation_session event=begin "));
  const end = lines.filter((line) => line.startsWith("vize_lsp_allocation_session event=end "));
  assert.equal(begin.length, 1);
  assert.equal(end.length, 1);
  for (const line of [...begin, ...end]) {
    assert.equal(integer(line, "pid"), BigInt(ownerPid));
    assert(line.includes("allocator=existing_ProfilingAllocator_MiMalloc"));
    assert(line.includes("diagnostic_only=true acceptance_credit=none"));
  }
  const totals = Object.fromEntries(
    COUNTERS.map((field) => {
      const before = integer(begin[0], field);
      const after = integer(end[0], field);
      assert(after >= before, `global counters reset: ${field}`);
      return [
        field,
        { before: String(before), after: String(after), delta: String(after - before) },
      ];
    }),
  );
  const windows = lines.filter(
    (line) => line.includes("vize_editor_allocation:") && line.includes('event="window"'),
  );
  assert(windows.length > 0, "actual phase windows required");
  for (const line of windows) {
    assert.equal(integer(line, "pid"), BigInt(ownerPid));
    assert(line.includes('scope="global_overlapping_window_with_observer_overhead"'));
    assert(line.includes('diagnostic_only=true acceptance_credit="none"'));
    for (const field of ["phase_size", "allocation_window_size", "allocation_field_size"])
      assert(integer(line, field) > 0n, `actual diagnostic shape required: ${field}`);
    for (const field of COUNTERS) {
      const before = integer(line, `before_${field}`);
      const after = integer(line, `after_${field}`);
      assert(before >= BigInt(totals[field].before), `window precedes owner session: ${field}`);
      assert(after >= before, `window reset: ${field}`);
      assert(after <= BigInt(totals[field].after), `window exceeds owner session: ${field}`);
    }
  }
  const storage = lines.filter(
    (line) =>
      line.includes("vize_editor_allocation:") && line.includes('event="native_fact_storage"'),
  );
  assert(storage.length > 0, "actual native container dimensions required");
  for (const line of storage) {
    assert.equal(integer(line, "pid"), BigInt(ownerPid));
    assert(line.includes('diagnostic_only=true acceptance_credit="none"'));
    for (const field of [
      "facts_len",
      "facts_capacity",
      "stamp_size",
      "map_len",
      "map_usable_capacity",
      "bucket_size",
      "old_vec_bucket_size",
      "map_pair_size",
      "old_map_pair_size",
      "empty_buckets",
      "singleton_buckets",
      "collision_buckets",
      "collision_indices",
      "collision_capacity",
      "index_size",
      "old_singleton_probe_capacity",
    ])
      integer(line, field);
    assert(line.includes('allocator_class="unobserved"'));
    assert(line.includes('arc_and_path_allocations="not_walked"'));
  }
  return {
    totals,
    windows: windows.length,
    storageReports: storage.length,
    scope: "global_requested_and_released_layout_bytes_include_observer_and_overlapping_threads",
    allocatorCoverage: "not_established",
    lifetimeAttribution: "none",
    callsiteAttribution: "none",
    acceptanceCredit: "none",
  };
}

export function assessMemoryArm(directory: string) {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  const launch = read("launch.json");
  const close = read("process-close.json");
  const metrics = read("original-metrics.json");
  const inputBytes = fs.readFileSync(path.join(directory, "inputs.json"));
  const inputs = JSON.parse(inputBytes.toString());
  assert.equal(sha256(inputBytes), launch.inputSha256);
  assert.equal(inputs.schema, "vize.lsp.allocation.original.inputs");
  assert.equal(inputs.version, 1);
  assert.equal(inputs.sourceRevision, launch.sourceRevision);
  assert.equal(inputs.role, launch.role);
  assert.equal(launch.driverObservation, "passive-wire-and-smaps-can-affect-scheduling-and-timing");
  assert.equal(launch.originalCiPerformanceCredit, "none");
  assert.deepEqual(Object.keys(launch.featureManifests).sort(), [
    "crates/vize/Cargo.toml",
    "crates/vize_canon/Cargo.toml",
  ]);
  for (const row of Object.values(launch.featureManifests) as {
    originalSha256: string;
    diagnosticSha256: string;
    sourceSha256: string;
  }[]) {
    assert.match(row.originalSha256, /^[a-f0-9]{64}$/);
    assert.match(row.diagnosticSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(row.originalSha256, row.diagnosticSha256);
    assert.equal(
      row.sourceSha256,
      launch.role === "first-original-ci" ? row.originalSha256 : row.diagnosticSha256,
    );
  }
  assert.equal(inputs.fixture.revision, "810faa8e5db4bbf9d6d408a61df148559340ee99");
  assert.equal(sha256(JSON.stringify(inputs.selected.files)), inputs.selected.sha256);
  assert(inputs.selected.files.length > 0 && inputs.selected.files.length <= 10000);
  assert.deepEqual(Object.keys(inputs.authoredSources).sort(), [
    "brokenDependency",
    "cleanDependency",
    "cleanSource",
    "leafBrokenSource",
  ]);
  for (const value of Object.values(inputs.authoredSources) as {
    text: string;
    bytes: number;
    sha256: string;
  }[]) {
    assert.equal(Buffer.byteLength(value.text), value.bytes);
    assert.equal(sha256(value.text), value.sha256);
  }
  assert.equal(close.complete, true);
  assert.equal(close.failure, null);
  assert.equal(close.code, 0);
  assert.equal(close.signal, null);
  assert.equal(close.fences, 63);
  assert.equal(close.owner.executableSha256, launch.binarySha256);
  assessPacketCustody(directory, launch, close);
  assert.equal(metrics.fixtureRevision, "810faa8e5db4bbf9d6d408a61df148559340ee99");
  assert.deepEqual(metrics.corpus, { vueFiles: 583, vueAndTypeScriptFiles: 888 });
  assert.equal(metrics.budget.scale, 1);
  assert.equal(metrics.budget.cyclesPerPhase, 20);
  assert.equal(metrics.budget.maxPeakRssMiB, 128);
  assert.equal(metrics.budget.maxPeakProcessTreeRssMiB, 384);
  assert.equal(metrics.budget.maxProcessTreeSize, 3);
  assert.equal(metrics.cycleStats.cycles, 40);
  assert.equal(metrics.rssSamples.length, 63);
  assert.deepEqual(metrics.budget, ORIGINAL_BUDGET);
  assert.deepEqual(
    metrics.rssSamples.map((row: { label: string }) => row.label),
    ORIGINAL_LABELS,
  );
  const rawFences = fs
    .readFileSync(path.join(directory, "fences.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rawFences.length, 63);
  rawFences.forEach((fence, index) => {
    assert.equal(fence.index, index);
    assert.deepEqual(fence.originalSample, metrics.rssSamples[index]);
    assert.deepEqual(fence.owner, close.owner);
    assert.equal(fence.failure, undefined);
    const bytes = fs.readFileSync(path.join(directory, fence.smaps.path));
    assert.equal(bytes.length, fence.smaps.bytes);
    assert.equal(sha256(bytes), fence.smaps.sha256);
  });
  for (const stream of ["client", "server", "stderr"]) {
    const bytes = fs.readFileSync(path.join(directory, `${stream}.bin`));
    assert.equal(bytes.length, close.streams[stream].bytes);
    assert.equal(sha256(bytes), close.streams[stream].sha256);
    if (stream !== "stderr") decodeFrames(bytes);
  }
  const stderr = fs.readFileSync(path.join(directory, "stderr.bin"), "utf8");
  const first = launch.role === "first-original-ci";
  assert(first || launch.role === "second-allocation-diagnostic");
  if (first) {
    assert.equal(launch.sourceRevision, FROZEN_SOURCE);
    assert(!stderr.includes("vize_lsp_allocation_session"));
    assert(!stderr.includes("vize_editor_allocation:"));
  }
  return {
    role: launch.role,
    sourceRevision: launch.sourceRevision,
    binarySha256: launch.binarySha256,
    originalStatus: metrics.status,
    originalFailure: metrics.failure,
    peakServerKiB: metrics.peakRssKiB,
    driverObservation: launch.driverObservation,
    originalCiPerformanceCredit: "none",
    allocation: first ? null : allocationWindows(stderr, close.owner.pid),
    acceptanceCredit: "none",
  };
}

/** Retain both raw vectors; normalize only fixture relocation and the bound initialize PID. */
export function assessMemoryPair(firstRoot: string, secondRoot: string) {
  const first = assessMemoryArm(firstRoot);
  const second = assessMemoryArm(secondRoot);
  assert.equal(first.role, "first-original-ci");
  assert.equal(second.role, "second-allocation-diagnostic");
  assert.notEqual(first.sourceRevision, second.sourceRevision);
  assert.notEqual(first.binarySha256, second.binarySha256);
  const input = (directory: string) =>
    JSON.parse(fs.readFileSync(path.join(directory, "inputs.json"), "utf8"));
  const a = input(firstRoot),
    b = input(secondRoot);
  for (const key of ["fixture", "selectedPath", "selected", "authoredSources"])
    assert.deepEqual(a[key], b[key]);
  const messages = (directory: string, stream: string) =>
    decodeFrames(fs.readFileSync(path.join(directory, `${stream}.bin`))).messages;
  const requests = (directory: string, workspace: string) =>
    originalClientVector(
      messages(directory, "client"),
      workspace,
      JSON.parse(fs.readFileSync(path.join(directory, "process-close.json"), "utf8")).owner,
    );
  assert.deepEqual(requests(firstRoot, a.workspaceDir), requests(secondRoot, b.workspaceDir));
  assert.deepEqual(
    originalServerVector(messages(firstRoot, "server"), a.workspaceDir),
    originalServerVector(messages(secondRoot, "server"), b.workspaceDir),
    "whole raw diagnostic and response vectors must match; divergence is retained as refusal",
  );
  return {
    first,
    second,
    completeOriginalClientVector: true,
    completeOriginalServerVector: true,
    dynamicBoundary: "one-initialize-processId-equals-authenticated-owner-parentPid",
    acceptanceCredit: "none",
    limitation:
      "separate diagnostic allocator build; no RSS, timing, lifetime or callsite causal credit",
  };
}
