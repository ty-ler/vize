import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectRenderReceipts,
  createRenderJobs,
  parseRenderWorkers,
  runRenderJobs,
  withRenderContext,
} from "../../docs/scripts/navigation-render-concurrency.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("render workers preserves 1/2 and admits only explicit four-worker execution", () => {
  assert.equal(parseRenderWorkers(undefined), 2);
  assert.equal(parseRenderWorkers("1"), 1);
  assert.equal(parseRenderWorkers("2"), 2);
  assert.equal(parseRenderWorkers("4"), 4);
  for (const invalid of [
    "",
    "0",
    "3",
    "5",
    "01",
    "2.0",
    " 2",
    "2workers",
    "-1",
    "Infinity",
    "04",
    "4.0",
    " 4",
    "4 ",
  ])
    assert.throws(() => parseRenderWorkers(invalid), /workers/);
});

test("four workers retain their slots until actual context cleanup completes", async () => {
  const jobs = createRenderJobs(["/a", "/b", "/c"]);
  const closing = Array.from({ length: 4 }, deferred);
  const allClosing = deferred();
  const nextStarted = deferred();
  const visits: number[] = [];
  let active = 0;
  let maximum = 0;
  let closeCount = 0;
  const running = runRenderJobs(jobs, 4, async (job, phase) =>
    withRenderContext(
      () =>
        phase("context", async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          visits.push(job.index);
          if (job.index === 4) nextStarted.resolve();
          return {
            close: async () => {
              if (job.index < 4) {
                closeCount += 1;
                if (closeCount === 4) allClosing.resolve();
                await closing[job.index].promise;
              }
              active -= 1;
            },
          };
        }),
      async () => ({ route: job.route, device: job.device }),
      (close) => phase("context-close", close),
    ),
  );
  await allClosing.promise;
  assert.equal(active, 4);
  assert.equal(maximum, 4);
  assert.deepEqual(visits, [0, 1, 2, 3], "closing contexts still occupy all four slots");
  closing[0].resolve();
  await nextStarted.promise;
  for (const gate of closing) gate.resolve();
  const results = await running;
  assert.equal(active, 0);
  assert.equal(maximum, 4);
  assert.deepEqual(
    visits,
    jobs.map(({ index }) => index),
  );
  assert.equal(collectRenderReceipts(jobs, results).length, jobs.length);
  assert(
    results.every(
      ({ timing }) => timing.worker < 4 && timing.phases.at(-1)?.phase === "context-close",
    ),
  );
});

test("four workers drain later jobs after operation and cleanup failures without success receipts", async () => {
  const jobs = createRenderJobs(["/ok", "/broken", "/dual", "/later"]);
  const closed: number[] = [];
  const results = await runRenderJobs(jobs, 4, async (job, phase) =>
    withRenderContext(
      () =>
        phase("context", async () => ({
          close: async () => {
            closed.push(job.index);
            if (job.route === "/dual") throw new Error("cleanup refusal");
          },
        })),
      async () => {
        await phase("navigation", async () => {
          if (["/broken", "/dual"].includes(job.route)) throw new Error("operation refusal");
        });
        return { route: job.route, device: job.device };
      },
      (close) => phase("context-close", close),
    ),
  );
  assert.deepEqual(
    closed.toSorted((a, b) => a - b),
    jobs.map(({ index }) => index),
  );
  assert.equal(results.length, 8);
  assert.equal(collectRenderReceipts(jobs, results).length, 4);
  for (const result of results.filter(({ job }) => ["/broken", "/dual"].includes(job.route))) {
    assert.equal(result.receipt, undefined);
    assert.equal(result.timing.status, "failed");
    assert.match(result.timing.error ?? "", /operation refusal/);
    if (result.job.route === "/dual") {
      assert.match(result.timing.error ?? "", /cleanup refusal/);
      assert.equal(result.timing.phases.at(-1)?.status, "failed");
    }
  }
  assert(
    results
      .filter(({ job }) => job.route === "/later")
      .every(({ timing }) => timing.status === "passed"),
  );
});

test("route/device jobs are complete, ordered and cannot collide in their output names", () => {
  const jobs = createRenderJobs(["/", "/home", "/a/b", "/a-b"]);
  assert.deepEqual(
    jobs.map(({ route, device }) => [route, device]),
    [
      ...["/", "/home", "/a/b", "/a-b"].map((route) => [route, "desktop"]),
      ...["/", "/home", "/a/b", "/a-b"].map((route) => [route, "mobile"]),
    ],
  );
  assert.equal(new Set(jobs.map(({ screenshot }) => screenshot)).size, jobs.length);
  for (const job of jobs) assert.match(job.screenshot, /^[a-zA-Z0-9_-]+\.png$/);
  for (const invalid of [[], ["/", "/"], ["/a", "/a/"], [""], ["a"], ["/a?b"], ["/../a"]])
    assert.throws(() => createRenderJobs(invalid));
});

test("two workers actually overlap, remain bounded, and aggregate in requested order", async () => {
  const jobs = createRenderJobs(["/a", "/b", "/c"]);
  const first = deferred();
  const secondStarted = deferred();
  let active = 0;
  let maximum = 0;
  const visits: number[] = [];
  const completing: number[] = [];
  const running = runRenderJobs(jobs, 2, async (job, phase) => {
    active += 1;
    maximum = Math.max(maximum, active);
    visits.push(job.index);
    await phase("navigation", async () => {
      if (job.index === 0) await first.promise;
      if (job.index === 1) secondStarted.resolve();
    });
    completing.push(job.index);
    active -= 1;
    return { route: job.route, device: job.device, index: job.index };
  });
  await secondStarted.promise;
  assert.equal(maximum, 2, "second job starts before the first finishes");
  first.resolve();
  const results = await running;
  assert.equal(maximum, 2);
  assert.deepEqual(
    visits,
    jobs.map(({ index }) => index),
  );
  assert.notDeepEqual(
    completing,
    jobs.map(({ index }) => index),
  );
  assert.deepEqual(
    collectRenderReceipts(jobs, results).map(({ index }) => index),
    visits,
  );
  for (const { timing } of results) {
    assert.equal(timing.status, "passed");
    assert(timing.durationMs >= 0);
    assert.equal(timing.phases[0].phase, "navigation");
    assert.equal(timing.phases[0].status, "passed");
    assert(timing.phases[0].durationMs >= 0);
  }
});

test("one worker executes the same complete jobs sequentially", async () => {
  const jobs = createRenderJobs(["/a", "/b"]);
  let active = 0;
  let maximum = 0;
  const results = await runRenderJobs(jobs, 1, async (job, phase) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await phase("navigation", async () => {
      await Promise.resolve();
    });
    active -= 1;
    return { route: job.route, device: job.device };
  });
  assert.equal(maximum, 1);
  assert.equal(collectRenderReceipts(jobs, results).length, jobs.length);
  assert(results.every(({ timing }) => timing.worker === 0));
  await assert.rejects(() => runRenderJobs(jobs, 3 as 2, async (job) => job), /workers/);
});

test("failed pages retain failed timings, close their contexts and do not get success receipts", async () => {
  const jobs = createRenderJobs(["/ok", "/broken"]);
  const closed: number[] = [];
  const results = await runRenderJobs(jobs, 2, async (job, phase) =>
    withRenderContext(
      async () => ({
        close: async () => {
          closed.push(job.index);
        },
      }),
      async () => {
        await phase("navigation", async () => {
          if (job.route === "/broken") throw new Error("missing route response");
        });
        return { route: job.route, device: job.device };
      },
      (close) => phase("context-close", close),
    ),
  );
  assert.deepEqual(
    closed.toSorted((a, b) => a - b),
    jobs.map(({ index }) => index),
  );
  assert.deepEqual(
    collectRenderReceipts(jobs, results).map(({ route }) => route),
    ["/ok", "/ok"],
  );
  for (const result of results.filter(({ job }) => job.route === "/broken")) {
    assert.equal(result.receipt, undefined);
    assert.equal(result.timing.status, "failed");
    assert.match(result.timing.error ?? "", /missing route response/);
    assert.equal(result.timing.phases[0].status, "failed");
    assert.equal(result.timing.phases[1].phase, "context-close");
    assert.equal(result.timing.phases[1].status, "passed");
  }
});

test("a context-close failure cannot mint a success receipt", async () => {
  const jobs = createRenderJobs(["/ok"]);
  const results = await runRenderJobs(jobs, 2, async (job, phase) =>
    withRenderContext(
      async () => ({
        close: async () => {
          throw new Error("context did not close");
        },
      }),
      async () => ({ route: job.route, device: job.device }),
      (close) => phase("context-close", close),
    ),
  );
  assert.equal(collectRenderReceipts(jobs, results).length, 0);
  assert(results.every(({ timing }) => timing.status === "failed"));
});

test("receipt aggregation rejects missing, repeated and wrongly attributed route/device evidence", async () => {
  const jobs = createRenderJobs(["/a", "/b"]);
  const results = await runRenderJobs(jobs, 2, async (job) => ({
    route: job.route,
    device: job.device,
  }));
  assert.throws(() => collectRenderReceipts(jobs, results.slice(1)), /coverage/);
  assert.throws(
    () => collectRenderReceipts(jobs, [results[0], results[0], ...results.slice(2)]),
    /duplicate/,
  );
  assert.throws(
    () =>
      collectRenderReceipts(jobs, [
        { ...results[0], receipt: { route: "/b", device: "desktop" } },
        ...results.slice(1),
      ]),
    /route\/device/,
  );
  assert.throws(
    () =>
      collectRenderReceipts(jobs, [
        {
          ...results[0],
          timing: { ...results[0].timing, status: "failed" as const },
          receipt: results[0].receipt,
        },
        ...results.slice(1),
      ]),
    /failed/,
  );
});
