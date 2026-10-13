import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

// The jobs API omitted every step of every completed job from 2026-10-13
// 21:15 UTC on. Only that complete absence switches canonical selection to
// the job window; one job that still reports steps keeps every step check.
export function stepless(jobs) {
  const completed = jobs.filter((job) => job?.status === "completed");
  return (
    completed.length > 0 &&
    completed.every((job) => Array.isArray(job.steps) && job.steps.length === 0)
  );
}

/** The job window bounds the upload; the artifact contents are still verified in full. */
export function uploadWindow(job) {
  assert.equal(job.steps.length, 0, "Partial canonical step inventory");
  return { started_at: job.started_at, completed_at: job.completed_at };
}

export const evidence = (jobs) => (stepless(jobs) ? { stepEvidence: "unavailable" } : {});

/** Leaves the fallback visible in the log and the job summary for later audit. */
export function report(selection, env = process.env) {
  if (!selection.workers.some((worker) => worker.stepEvidence === "unavailable")) return selection;
  const message =
    "Canonical worker steps unavailable: the GitHub jobs API returned no steps for any completed job, so uploads were bound to the observer job windows.";
  process.stdout.write(`::warning title=Canonical step evidence unavailable::${message}\n`);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### Canonical step evidence unavailable\n\n${message}\n`,
    );
  return selection;
}
