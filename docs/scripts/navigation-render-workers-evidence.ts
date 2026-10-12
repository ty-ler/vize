import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRenderJobs } from "./navigation-render-concurrency.ts";
import { defaultNavigationRenderRoutes } from "./navigation-render-routes.ts";
import { workersCaptureEvidence } from "./navigation-render-workers-captures.ts";
import { assertWorkersEvidenceEqual } from "./navigation-render-workers-equality.ts";
import {
  list,
  number,
  packet,
  text,
  normalizeWorkersPacket,
} from "./navigation-render-workers-packets.ts";
export { packet, normalizeWorkersPacket } from "./navigation-render-workers-packets.ts";

async function json(dir: string, file: string) {
  return packet(JSON.parse(await readFile(path.join(dir, file), "utf8")));
}
const jobPhases = [
  "context",
  "navigation",
  "assets",
  "japanese-fonts",
  "metrics",
  "table-code",
  "navigation-assertions",
  "theme-readability",
  "rule-packets",
  "command-tabs",
  "layout",
  "links",
  "capture",
  "theme-captures",
  "context-close",
];
/** Conservative millisecond bounds prove completed creations precede any close, not just job starts. */
export function provedContextOverlap(jobs: unknown[]) {
  const boundaries: { time: number; delta: number }[] = [];
  for (const value of jobs) {
    const phases = list(packet(value).phases).map(packet);
    const created = phases.find((phase) => phase.phase === "context");
    const closed = phases.find((phase) => phase.phase === "context-close");
    assert(created && closed, "Actual context creation and close evidence is required");
    const start = Date.parse(text(created.startedAt)) + Math.ceil(number(created.durationMs)) + 1;
    const end = Date.parse(text(closed.startedAt));
    assert(
      Number.isFinite(start) && Number.isFinite(end) && start < end,
      "Context must exist before its close",
    );
    boundaries.push({ time: start, delta: 1 }, { time: end, delta: -1 });
  }
  let active = 0;
  let maximum = 0;
  for (const entry of boundaries.sort((a, b) => a.time - b.time || a.delta - b.delta)) {
    active += entry.delta;
    maximum = Math.max(maximum, active);
  }
  assert.equal(active, 0, "Every real context drains");
  return maximum;
}

export type WorkersExpectedSource = {
  source: string;
  dist: string;
  sourceFiles: { file: string; bytes: number; sha256: string }[];
};
export const localeSourceFiles = [
  "docs/theme/i18n/locale-switcher.js",
  "docs/theme/i18n/locale-selector.css",
  "docs/theme/i18n/navigation.js",
  "docs/theme/background.ts",
  "docs/scripts/locale-render-assertions.ts",
  "docs/scripts/locale-responsive-assertions.ts",
  "docs/scripts/locale-control-render.ts",
  "docs/scripts/verify-navigation-render.ts",
];

export async function workersArmEvidence(
  dir: string,
  workers: 2 | 4,
  expected: WorkersExpectedSource,
) {
  const { source, dist, sourceFiles } = expected;
  const receipt = await json(dir, "receipt.json");
  const timings = await json(dir, "timings.json");
  const captures = await json(dir, "capture-timings.json");
  const control = await json(dir, "capture-controls/receipt.json");
  const locale = await json(dir, "locale-controls/receipt.json");
  const jobs = createRenderJobs(defaultNavigationRenderRoutes);
  assert.equal(jobs.length, 238, "Whole current route/device census is required");
  const requested = jobs.map(({ index, route, device }) => ({ index, route, device }));
  for (const record of [receipt, timings]) {
    assert.equal(record.status, "passed", "Whole campaign must pass");
    assert.equal(record.workers, workers, "Exact worker arm required");
    assert.equal(record.expectedCount, jobs.length);
    assert.deepEqual(
      record.requestedJobs,
      requested,
      "Whole manifest order and membership required",
    );
  }
  assert.equal(timings.schemaVersion, 1);
  assert.deepEqual(timings.routes, defaultNavigationRenderRoutes);
  assert.equal(timings.passedCount, 238);
  assert.equal(timings.failedCount, 0);
  assert.equal(timings.incompleteCount, 0);
  number(timings.durationMs);
  const globalPhases = list(timings.phases).map(packet);
  assert.deepEqual(
    globalPhases.map((phase) => phase.phase),
    ["browser-launch", "capture-controls", "browser-close", "server-close"],
  );
  assert(
    globalPhases.every((phase) => phase.status === "passed"),
    "Browser/server/control cleanup must pass",
  );
  const jobTimings = list(timings.jobs).map(packet);
  assert.deepEqual(
    jobTimings.map(({ index, route, device }) => ({ index, route, device })),
    requested,
  );
  for (const timing of jobTimings) {
    assert.equal(timing.status, "passed");
    assert(
      Number.isInteger(timing.worker) && number(timing.worker) < workers,
      "Bounded worker identity",
    );
    const phases = list(timing.phases).map(packet);
    assert.deepEqual(
      phases.map((phase) => phase.phase),
      jobPhases,
      "Every original page boundary and close required",
    );
    assert(
      phases.every((phase) => phase.status === "passed"),
      "All original phases must pass",
    );
    const start = Date.parse(text(timing.startedAt));
    const end = start + number(timing.durationMs);
    let preceding = start;
    for (const phase of phases) {
      const at = Date.parse(text(phase.startedAt));
      assert(
        Number.isFinite(at) && at >= preceding - 2 && at + number(phase.durationMs) <= end + 2,
        "Phase order and awaited cleanup bounds",
      );
      preceding = at + number(phase.durationMs);
    }
  }
  const overlap = provedContextOverlap(jobTimings);
  assert.equal(
    overlap,
    workers,
    "Actual completed browser contexts must achieve the requested overlap",
  );
  assert.equal(captures.schemaVersion, 1);
  assert.equal(captures.source, source);
  assert.equal(receipt.dist, dist, "Packet must name the authenticated physical build");
  assert.equal(captures.dist, receipt.dist);
  assert.equal(timings.dist, receipt.dist);
  assert.equal(captures.workers, workers);
  assert.equal(captures.status, "passed");
  assert.equal(captures.screenshotIncludesPreparationEncodingTransferAndPngWrite, true);
  assert.equal(locale.sourceHead, source);
  assert.equal(packet(locale.workflow).sha, source);
  assert.deepEqual(
    locale.source,
    localeSourceFiles.map((file) => {
      const entries = sourceFiles.filter((entry) => entry.file === file);
      assert.equal(entries.length, 1, "Complete physical locale source custody required");
      const { bytes, sha256 } = entries[0];
      return { file, bytes, sha256 };
    }),
    "Original locale source vector must match the authenticated checkout",
  );
  assert.equal(locale.completed, true);
  assert.equal(locale.failure, null);
  const localeCases = list(locale.cases).map(packet);
  assert.deepEqual(
    localeCases.map((entry) => entry.name),
    ["desktop", "mobile"].flatMap((device) =>
      ["en", "ja"].flatMap((language) =>
        ["light", "dark"].map((theme) => `${language}-${device}-${theme}`),
      ),
    ),
  );
  const origin = new URL(text(packet(localeCases[0].html).url)).origin;
  assert.match(
    origin,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    "Only the owned loopback server is normalized",
  );
  const { reports, normalizedEvents, rawFiles } = await workersCaptureEvidence(
    dir,
    jobs,
    receipt,
    captures,
    control,
    localeCases,
  );
  return {
    workers,
    overlap,
    durationMs: timings.durationMs,
    evidence: normalizeWorkersPacket(
      { reports, control, locale, events: normalizedEvents, rawFiles },
      origin,
    ),
  };
}

export async function qualifyWorkersPair(
  baseline: string,
  candidate: string,
  expected: WorkersExpectedSource,
) {
  const two = await workersArmEvidence(baseline, 2, expected);
  const four = await workersArmEvidence(candidate, 4, expected);
  assertWorkersEvidenceEqual(
    two.evidence,
    four.evidence,
    "Full original source/font/link/theme/layout/control/PNG custody must agree",
  );
  return {
    schemaVersion: 1,
    source: expected.source,
    status: "passed",
    routes: 119,
    pages: 238,
    arms: [two, four].map(({ evidence: _evidence, ...arm }) => arm),
  };
}
