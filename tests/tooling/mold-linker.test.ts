import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

interface Step {
  uses?: string;
  with?: { path?: string; ref?: string };
}

interface Workflow {
  jobs: Record<string, { steps?: Step[] }>;
}

test("mold setup resolves inside an existing checkout, including paired benchmark worktrees", () => {
  let callers = 0;
  for (const filename of readdirSync(".github/workflows")) {
    if (!filename.endsWith(".yml")) continue;
    const workflow = parse(readFileSync(`.github/workflows/${filename}`, "utf8")) as Workflow;
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const checkouts = new Map<string, Step>();
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@")) {
          checkouts.set(step.with?.path ?? ".", step);
        }
        const match = /^\.\/(.*?)\.?github\/actions\/setup-mold$/.exec(step.uses ?? "");
        if (!match) continue;
        callers++;
        const root = match[1].replace(/\/$/, "") || ".";
        assert.ok(checkouts.has(root), `${filename}/${name}: ${step.uses} needs checkout ${root}`);
        if (filename === "sfc-parse-replay.yml") {
          assert.equal(root, "harness", "historical source does not contain the current action");
          assert.equal(checkouts.get(root)?.with?.ref, "${{ github.sha }}");
        }
      }
    }
  }
  assert.ok(callers > 0, "no mold workflow callers found");
});
