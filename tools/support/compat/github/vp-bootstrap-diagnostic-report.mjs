import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { context, hash } from "./vp-bootstrap-diagnostic-contract.mjs";

export async function collectLogs() {
  const identity = context(process.env);
  const dir = join(process.env.RUNNER_TEMP, "vp-bootstrap-report");
  mkdirSync(dir, { recursive: true });
  const headers = {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const comparison = {
    identity,
    lanes: {},
    errors: [],
    limits: [
      "dependency cache disabled in both lanes; original cache:true baseline is not a whole-job comparator",
      "cold normal integrity checks; warm normal existing-install semantics, not fresh restored-byte verification",
      "all original full Check jobs, gates and commands remain unchanged",
    ],
  };
  const persist = () =>
    writeFileSync(join(dir, "comparison.json"), JSON.stringify(comparison, null, 2) + "\n");
  persist();
  try {
    const url = `https://api.github.com/repos/${identity.repository}/actions/runs/${identity.run}/attempts/${identity.attempt}/jobs?per_page=100`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    assert(response.ok, `job metadata request failed: ${response.status}`);
    const jobs = await response.json();
    assert(jobs.total_count <= 100, "diagnostic job lookup must not be truncated");
    for (const lane of ["cold", "warm"]) {
      const item = (comparison.lanes[lane] = { error: null });
      try {
        const job = jobs.jobs.find(
          (value) =>
            value.name === `Vite+ bootstrap diagnostic / Vite+ bootstrap diagnostic (${lane})`,
        );
        assert(job, `missing ${lane} diagnostic job`);
        Object.assign(item, {
          job: job.id,
          jobUrl: job.html_url,
          conclusion: job.conclusion,
          metadata: job,
        });
        const logUrl = `https://api.github.com/repos/${identity.repository}/actions/jobs/${job.id}/logs`;
        item.logUrl = logUrl;
        if (job.conclusion === "skipped") throw new Error(`${lane} skipped; no SDK measurements`);
        const logs = await fetch(logUrl, { headers, signal: AbortSignal.timeout(30000) });
        assert(logs.ok, `${lane} logs unavailable: ${logs.status}`);
        const raw = await logs.text();
        writeFileSync(join(dir, `${lane}.job.raw.log`), raw);
        item.rawSha256 = hash(raw);
        item.urls = [...new Set(raw.match(/https:\/\/[^\s"'<>]+/g) ?? [])];
        item.setup =
          job.steps.find((step) => step.name === "Set up exact Vite+ and install the workspace") ??
          null;
        item.setupTimingAuthority =
          "lane setup-duration.json; API may expose only the composite outer step";
        const phase = (label) =>
          raw
            .split("\n")
            .find((line) => line.includes(label))
            ?.slice(0, 28);
        item.prepareStart = phase("Preparing Node.js and pnpm...");
        item.prepareEnd = phase("Installing dependencies...");
        item.preparationSeconds =
          item.prepareStart && item.prepareEnd
            ? (Date.parse(item.prepareEnd) - Date.parse(item.prepareStart)) / 1000
            : null;
        if (job.conclusion !== "success")
          throw new Error(`${lane} failed; retained partial evidence`);
      } catch (error) {
        item.error = error.message;
        comparison.errors.push(error.message);
      }
      persist();
    }
  } catch (error) {
    comparison.errors.push(error.message);
  } finally {
    persist();
  }
  assert.equal(
    comparison.errors.length,
    0,
    "diagnostic incomplete; inspect retained comparison and raw logs",
  );
}
