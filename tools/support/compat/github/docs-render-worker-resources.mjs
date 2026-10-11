import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Preserve Linux PID/start ticks: a reused numeric PID is a different process. */
export function parseProcessStat(text, pageBytes) {
  const end = text.lastIndexOf(")");
  assert(end > 0, "Complete Linux process stat");
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const pid = Number(text.slice(0, text.indexOf(" ")));
  const ppid = Number(fields[1]);
  const cpuTicks = Number(fields[11]) + Number(fields[12]);
  const startTicks = Number(fields[19]);
  const rssBytes = Number(fields[21]) * pageBytes;
  assert([pid, ppid, cpuTicks, startTicks, rssBytes].every(Number.isSafeInteger));
  assert(pid > 0 && ppid >= 0 && cpuTicks >= 0 && startTicks >= 0 && rssBytes >= 0);
  return { pid, ppid, identity: `${pid}:${startTicks}`, state: fields[0], cpuTicks, rssBytes };
}

export function selectProcessTree(processes, rootPid, known = new Set()) {
  const selected = new Map();
  const knownRoot = [...known].some((identity) => identity.startsWith(`${rootPid}:`));
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (selected.has(process.pid)) continue;
      if (
        (process.pid === rootPid && (!knownRoot || known.has(process.identity))) ||
        selected.has(process.ppid) ||
        known.has(process.identity)
      ) {
        selected.set(process.pid, process);
        changed = true;
      }
    }
  }
  return [...selected.values()];
}

export async function siteInventory(directory) {
  const files = [];
  async function visit(relative) {
    for (const entry of (
      await readdir(path.join(directory, relative), { withFileTypes: true })
    ).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else {
        assert(entry.isFile(), `Built Docs inventory refuses non-file ${name}`);
        const bytes = await readFile(path.join(directory, name));
        files.push({ file: name, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit("");
  assert(files.length > 0, "The paired built site is not empty");
  return files;
}

async function processes(pageBytes) {
  const names = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  const results = await Promise.allSettled(
    names.map(async (name) =>
      parseProcessStat(await readFile(`/proc/${name}/stat`, "utf8"), pageBytes),
    ),
  );
  return results.flatMap((result) => {
    if (result.status === "fulfilled") return [result.value];
    if (["ENOENT", "ESRCH"].includes(result.reason?.code)) return [];
    throw result.reason;
  });
}

async function measure(workers, output) {
  assert.equal(
    process.platform,
    "linux",
    "Actual worker resource measurement requires Linux /proc",
  );
  assert(["2", "4"].includes(workers), "Measure exactly two or four workers");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(sourceSha, process.env.GITHUB_SHA, "The paired workflow checks out its exact SHA");
  const rendererSha256 = sha256(await readFile("docs/scripts/verify-navigation-render.ts"));
  const dist = path.resolve("docs/dist");
  const manifest = JSON.parse(await readFile(path.join(dist, "_og/manifest.json"), "utf8"));
  assert.equal(manifest.sourceSha, sourceSha, "Measured site was built from this source SHA");
  await mkdir(output, { recursive: true });
  const inventory = await siteInventory(dist);
  await writeFile(
    path.join(output, "site-inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  const pageBytes = Number(execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim());
  const ticksPerSecond = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
  assert(Number.isSafeInteger(pageBytes) && pageBytes > 0);
  assert(Number.isSafeInteger(ticksPerSecond) && ticksPerSecond > 0);
  const memoryBefore = await readFile("/proc/meminfo", "utf8");
  const cpuQuota = await readFile("/sys/fs/cgroup/cpu.max", "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const trace = await open(path.join(output, "process-samples.jsonl"), "w");
  const argv = [
    "docs/scripts/verify-navigation-render.ts",
    "--workers",
    workers,
    "--output",
    output,
  ];
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const observerCpuStart = process.cpuUsage();
  const command = [
    "--verbose",
    "--output",
    path.join(output, "waited-resources.txt"),
    process.execPath,
    ...argv,
  ];
  const child = spawn("/usr/bin/time", command, { stdio: "inherit" });
  let outcome;
  let finished = false;
  const completion = new Promise((resolve) => {
    child.once("error", (error) => {
      finished = true;
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("exit", (code, signal) => {
      finished = true;
      resolve({ code, signal });
    });
  });
  const identities = new Set();
  const observed = new Map();
  let samples = 0;
  let peakTreeRssBytes = 0;
  let maximumProcesses = 0;
  let samplingFailure;
  let durationMs;
  try {
    while (!finished) {
      const members = selectProcessTree(await processes(pageBytes), child.pid, identities);
      for (const member of members) {
        identities.add(member.identity);
        observed.set(member.identity, member);
      }
      const rssBytes = members.reduce((sum, member) => sum + member.rssBytes, 0);
      peakTreeRssBytes = Math.max(peakTreeRssBytes, rssBytes);
      maximumProcesses = Math.max(maximumProcesses, members.length);
      await trace.write(
        `${JSON.stringify({ atMs: performance.now() - start, rssBytes, members })}\n`,
      );
      samples += 1;
      if (samples % 150 === 0) {
        const elapsedMs = performance.now() - start;
        const cpuSeconds =
          [...observed.values()].reduce((sum, member) => sum + member.cpuTicks, 0) / ticksPerSecond;
        console.log(
          `Docs worker sample: ${JSON.stringify({
            workers: Number(workers),
            elapsedMs,
            peakTreeRssBytes,
            observedCpuCoresLowerBound: cpuSeconds / (elapsedMs / 1000),
          })}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    outcome = await completion;
    durationMs = performance.now() - start;
    const remaining = selectProcessTree(await processes(pageBytes), child.pid, identities).filter(
      (member) => !["Z", "X"].includes(member.state),
    );
    assert.equal(
      remaining.length,
      0,
      "Original browser/context cleanup leaves no observed live child",
    );
    assert(samples > 0 && observed.size > 0, "Actual process-tree samples are required");
    assert.deepEqual(
      await siteInventory(dist),
      inventory,
      "The original built site did not change during measurement",
    );
  } catch (error) {
    samplingFailure = error.stack ?? error.message;
    // Sampling failure is not success; retain the real original child outcome.
    outcome = await completion;
    durationMs ??= performance.now() - start;
  } finally {
    await trace.close();
  }
  const status =
    outcome.code === 0 && outcome.signal === null && !samplingFailure ? "passed" : "failed";
  const receipt = {
    schema: "vize.docs.worker-resources",
    schemaVersion: 1,
    sourceSha,
    rendererSha256,
    dist,
    workers: Number(workers),
    argv: ["/usr/bin/time", ...command],
    nodeVersion: process.version,
    startedAt,
    durationMs,
    status,
    outcome,
    runner: {
      parallelism: availableParallelism(),
      totalMemoryBytes: totalmem(),
      cpuQuota,
      memoryBefore,
      memoryAfter: await readFile("/proc/meminfo", "utf8"),
    },
    samples,
    sampleIntervalMs: 200,
    maximumProcesses,
    peakTreeRssBytes,
    observedCpuTicks: [...observed.values()].reduce((sum, member) => sum + member.cpuTicks, 0),
    ticksPerSecond,
    pageBytes,
    observerCpuMicroseconds: process.cpuUsage(observerCpuStart),
    resourceScope:
      "200ms sampled sum of resident bytes, including shared pages once per process; observed CPU ticks are a lower bound excluding work after the last sample of an exited process",
    siteInventorySha256: sha256(JSON.stringify(inventory)),
    ...(samplingFailure ? { samplingFailure } : {}),
  };
  await writeFile(path.join(output, "resources.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal(status, "passed", JSON.stringify({ outcome, samplingFailure }));
  console.log(
    `Docs ${workers}-worker resources: ${JSON.stringify({ durationMs, samples, peakTreeRssBytes, maximumProcesses })}`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: { workers: { type: "string" }, output: { type: "string" } },
  });
  assert(values.workers && values.output, "--workers and --output are required");
  await measure(values.workers, path.resolve(values.output));
}
