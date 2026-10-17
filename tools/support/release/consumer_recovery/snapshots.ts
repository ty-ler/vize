import assert from "node:assert/strict";
import { object, same, type Json } from "./policy.ts";

// GitHub embeds current repository clocks in historical API responses. Only
// these values are mutable here; presence, type and every other field remain exact.
// Comparison views never rewrite the retained raw evidence or signed receipt.
function repositoryView(value: unknown): Json {
  const view = { ...object(value) };
  for (const field of ["pushed_at", "updated_at"]) {
    if (!Object.hasOwn(view, field)) continue;
    assert.ok(
      typeof view[field] === "string" || view[field] === null,
      `repository ${field} must be a string or null`,
    );
    if (typeof view[field] === "string") view[field] = "";
  }
  return view;
}

function runView(value: unknown): Json {
  const view = { ...object(value) };
  for (const field of ["repository", "head_repository"])
    if (Object.hasOwn(view, field)) view[field] = repositoryView(view[field]);
  return view;
}

export function sameRunSnapshot(actual: unknown, expected: unknown, message: string) {
  same(runView(actual), runView(expected), message);
}

function integrationView(value: unknown): Json {
  const view = { ...object(value) };
  const integration = { ...object(view.integration) };
  for (const side of ["head", "base"]) {
    const branch = object(integration[side]);
    integration[side] = { ...branch, repo: repositoryView(branch.repo) };
  }
  const gates = object(view.gates);
  assert.ok(Array.isArray(gates.workflow_runs), "complete integration runs required");
  return {
    ...view,
    integration,
    gates: { ...gates, workflow_runs: gates.workflow_runs.map(runView) },
  };
}

export function sameIntegrationSnapshot(actual: unknown, expected: unknown, message: string) {
  same(integrationView(actual), integrationView(expected), message);
}

export function sameOriginalSnapshot(actual: Json, expected: Json, phase: string) {
  for (const key of [
    "policy",
    "run",
    "jobs",
    "failed",
    "log",
    "logIdentity",
    "blobs",
    "artifacts",
    "pin",
    "sourceReceipt",
  ]) {
    const compare = key === "run" ? sameRunSnapshot : same;
    compare(actual[key], expected[key], `original ${key} changed ${phase}`);
  }
}
