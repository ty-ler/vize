import assert from "node:assert/strict";

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
