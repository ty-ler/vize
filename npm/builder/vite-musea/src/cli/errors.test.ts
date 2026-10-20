import assert from "node:assert/strict";
import test from "node:test";
import { formatCliError } from "./errors.ts";

void test("CLI errors print actionable messages without stack traces", () => {
  const error = new Error("run once with --adopt-legacy-snapshots");
  assert.equal(formatCliError(error), "run once with --adopt-legacy-snapshots");
  assert.ok(!formatCliError(error).includes("Error:"));
  assert.ok(!formatCliError(error).includes("at "));
});
