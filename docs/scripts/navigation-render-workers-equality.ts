import { AssertionError } from "node:assert";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const missing = Symbol("missing JSON member");
const bounded = (value: string, length: number) =>
  JSON.stringify(value.slice(0, length)).slice(0, length + 2);

function summary(value: unknown): string {
  if (value === missing) return "missing";
  if (value === null) return "null";
  if (typeof value === "object")
    return `${Array.isArray(value) ? "array" : "object"}(${Object.keys(value).length})`;
  const type = typeof value;
  if (!["string", "number", "boolean", "undefined"].includes(type)) return `non-json:${type}`;
  const body =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? value.toString()
        : typeof value === "boolean"
          ? value
            ? "true"
            : "false"
          : "undefined";
  return `${type}:sha256=${createHash("sha256").update(body).digest("hex")}`;
}

/** Compare every original value; only the diagnostic retention has a bound. */
export function assertWorkersEvidenceEqual(
  actual: unknown,
  expected: unknown,
  label = "Full original source/font/link/theme/layout/control/PNG custody must agree",
): void {
  if (isDeepStrictEqual(actual, expected)) return;
  const parts: (string | number)[] = [];
  let differences = 0;
  let first = "";
  function difference(left: unknown, right: unknown) {
    differences++;
    if (first) return;
    const digest = createHash("sha256");
    for (const part of parts)
      digest
        .update(`${typeof part}:`)
        .update(String(part))
        .update("\0");
    const location = parts
      .slice(0, 12)
      .map((part) => `[${typeof part === "number" ? part : bounded(part, 32)}]`)
      .join("")
      .slice(0, 256);
    first = `path=$${location}; pathSha256=${digest.digest("hex")}; actual=${summary(left)}; expected=${summary(right)}`;
  }
  function absent(value: unknown, actualMissing: boolean) {
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length) {
        for (const key of keys) {
          parts.push(key);
          absent((value as Record<string, unknown>)[key], actualMissing);
          parts.pop();
        }
        return;
      }
    }
    difference(actualMissing ? missing : value, actualMissing ? value : missing);
  }
  function visit(left: unknown, right: unknown) {
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        parts.push(index);
        if (index >= left.length) absent(right[index], true);
        else if (index >= right.length) absent(left[index], false);
        else visit(left[index], right[index]);
        parts.pop();
      }
      return;
    }
    if (
      left !== null &&
      right !== null &&
      typeof left === "object" &&
      typeof right === "object" &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const a = left as Record<string, unknown>;
      const b = right as Record<string, unknown>;
      for (const key of Object.keys(a)) {
        parts.push(key);
        if (Object.hasOwn(b, key)) visit(a[key], b[key]);
        else absent(a[key], false);
        parts.pop();
      }
      for (const key of Object.keys(b)) {
        if (Object.hasOwn(a, key)) continue;
        parts.push(key);
        absent(b[key], true);
        parts.pop();
      }
      return;
    }
    if (
      (left !== null && typeof left === "object") ||
      (right !== null && typeof right === "object")
    ) {
      absent(left, false);
      absent(right, true);
    } else difference(left, right);
  }
  visit(actual, expected);
  // The strict oracle also rejects non-JSON structural/prototype differences.
  if (!differences) difference(actual, expected);
  const refusal = new AssertionError({
    message: `${bounded(label, 96)}: ${differences} leaf differences; ${first}`,
  });
  refusal.operator = "deepStrictEqual";
  Reflect.deleteProperty(refusal, "actual");
  Reflect.deleteProperty(refusal, "expected");
  throw refusal;
}
