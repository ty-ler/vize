import assert from "node:assert/strict";

export type InputRange = { index: number; start: number; end: number };

// CI selects these process counts explicitly. An unset variable keeps each
// campaign's original fixed default, so local and manual runs are unchanged.
export function processCount(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  { min = 1, max = 32 }: { min?: number; max?: number } = {},
): number {
  const raw = environment[key];
  if (raw === undefined) return fallback;
  assert.match(raw, /^[1-9][0-9]*$/u, `${key} must be a positive integer`);
  const count = Number(raw);
  assert.ok(count >= min && count <= max, `${key} must be between ${min} and ${max}`);
  return count;
}

// Fixed, contiguous and non-empty ranges of one ordered input list. Range i
// starts at ceil(i * length / count), so two ranges keep the original split.
export function contiguousRanges(length: number, count: number): InputRange[] {
  assert.ok(Number.isSafeInteger(count) && count >= 1, "range count must be a positive integer");
  assert.ok(Number.isSafeInteger(length) && length >= count, "every range needs one input");
  const boundary = (index: number) => Math.ceil((index * length) / count);
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: boundary(index),
    end: boundary(index + 1),
  }));
}
