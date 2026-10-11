import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  parseProcessStat,
  selectProcessTree,
  sha256,
} from "../../tools/support/compat/github/docs-render-worker-resources.mjs";
import {
  authenticateFiles,
  deriveDefaultJobs,
  normalizeOrigin,
} from "../../tools/support/compat/github/compare-docs-render-workers.mjs";

void test("complete default manifest derives from authenticated original CLI without route selection", () => {
  const directory = path.resolve("measurement");
  const resources = {
    workers: 2,
    rendererSha256: "original-complete-driver",
    argv: [
      "/usr/bin/time",
      "--verbose",
      "--output",
      path.join(directory, "waited-resources.txt"),
      process.execPath,
      "docs/scripts/verify-navigation-render.ts",
      "--workers",
      "2",
      "--output",
      directory,
    ],
  };
  const timings = { routes: ["/", "/ja/rules/all", "/fr/rules/accessibility"] };
  const jobs = deriveDefaultJobs(resources, timings, directory, resources.rendererSha256);
  assert.equal(jobs.length, 6);
  assert.deepEqual(
    jobs.map(({ route }) => route),
    [...timings.routes, ...timings.routes],
  );
  assert.throws(
    () =>
      deriveDefaultJobs(
        { ...resources, argv: [...resources.argv, "--routes", "/"] },
        timings,
        directory,
        resources.rendererSha256,
      ),
    /without route selection/,
  );
  assert.throws(
    () => deriveDefaultJobs(resources, timings, directory, "modified-driver"),
    /original renderer source bytes/,
  );
  assert.throws(() =>
    deriveDefaultJobs(resources, { routes: [] }, directory, resources.rendererSha256),
  );
});

void test("resource membership follows child ancestry and refuses a reused PID identity", () => {
  const processes = [
    { pid: 30, ppid: 20, identity: "30:300", state: "S", cpuTicks: 5, rssBytes: 1000 },
    { pid: 20, ppid: 10, identity: "20:200", state: "S", cpuTicks: 4, rssBytes: 2000 },
    { pid: 10, ppid: 1, identity: "10:100", state: "S", cpuTicks: 3, rssBytes: 3000 },
    { pid: 40, ppid: 1, identity: "40:400", state: "S", cpuTicks: 8, rssBytes: 4000 },
  ];
  assert.deepEqual(
    selectProcessTree(processes, 10)
      .map(({ pid }) => pid)
      .toSorted((a, b) => a - b),
    [10, 20, 30],
  );
  assert.deepEqual(
    selectProcessTree(processes, 999, new Set(["20:200"]))
      .map(({ pid }) => pid)
      .toSorted((a, b) => a - b),
    [20, 30],
  );
  assert.deepEqual(selectProcessTree(processes, 999, new Set(["20:old-start-ticks"])), []);
  assert.deepEqual(selectProcessTree(processes, 10, new Set(["10:old-start-ticks"])), []);
});

void test("Linux stat parsing retains process start ticks and its own CPU/RSS operands", () => {
  const stat =
    "42 (browser (tab) worker) S 9 42 42 0 -1 4194560 120 0 4 0 17 3 999 888 20 0 1 0 12345 4096 7";
  assert.deepEqual(parseProcessStat(stat, 4096), {
    pid: 42,
    ppid: 9,
    identity: "42:12345",
    state: "S",
    cpuTicks: 20,
    rssBytes: 28672,
  });
  assert.throws(() => parseProcessStat("42 (truncated) S", 4096));
});

void test("ephemeral origin equivalence retains full URL paths, queries, anchors and foreign operands", () => {
  const original = {
    links: [
      "http://127.0.0.1:32100/a?state=hello%20world#bad",
      "http://127.0.0.1:32000/a#bad",
      "https://example.test/a#bad",
    ],
    code: "entire authored code",
    rectangle: [1, 2, 3, 4],
    sha256: "whole-PNG-digest",
  };
  assert.deepEqual(normalizeOrigin(original, "http://127.0.0.1:32100"), {
    ...original,
    links: [
      "http://docs-render.invalid/a?state=hello%20world#bad",
      original.links[1],
      original.links[2],
    ],
  });
  assert.throws(() => normalizeOrigin(original, "https://example.test"));
  assert.equal(
    normalizeOrigin("http://127.0.0.1:32100/a", "http://127.0.0.1:3210"),
    "http://127.0.0.1:32100/a",
  );
  assert.notDeepEqual(
    normalizeOrigin({ ...original, rectangle: [1, 2, 3, 5] }, "http://127.0.0.1:32100"),
    normalizeOrigin(original, "http://127.0.0.1:32100"),
  );
  assert.notDeepEqual(
    normalizeOrigin({ ...original, sha256: "changed-PNG" }, "http://127.0.0.1:32100"),
    normalizeOrigin(original, "http://127.0.0.1:32100"),
  );
});

void test("whole carrier authentication retains HTML origin evidence and rejects changed or escaped bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "vize-docs-worker-carrier-"));
  try {
    const bytes = Buffer.from('<a href="http://127.0.0.1:32100/a?q=whole#good">Entire source</a>');
    const packet = {
      file: "whole.html",
      bytes: bytes.length,
      sha256: sha256(bytes),
      retained: "complete operand",
    };
    await writeFile(path.join(directory, packet.file), bytes);
    const journal: object[] = [];
    const normalized = await authenticateFiles(
      packet,
      directory,
      "http://127.0.0.1:32100",
      journal,
    );
    assert.equal(normalized.retained, packet.retained);
    assert.equal(
      normalized.sha256,
      sha256(Buffer.from('<a href="http://docs-render.invalid/a?q=whole#good">Entire source</a>')),
    );
    assert.equal(journal.length, 1);
    await writeFile(path.join(directory, packet.file), Buffer.from("Changed complete source"));
    await assert.rejects(
      () => authenticateFiles(packet, directory, "http://127.0.0.1:32100", []),
      /original complete carrier SHA256/,
    );
    await assert.rejects(
      () =>
        authenticateFiles(
          { ...packet, file: "../escape.html" },
          directory,
          "http://127.0.0.1:32100",
          [],
        ),
      /owning directory/,
    );
    await assert.rejects(
      () =>
        authenticateFiles(
          { ...packet, file: "missing.html" },
          directory,
          "http://127.0.0.1:32100",
          [],
        ),
      /ENOENT/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
