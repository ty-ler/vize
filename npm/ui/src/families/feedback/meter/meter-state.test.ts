import assert from "node:assert/strict";

import { test } from "vite-plus/test";

import { getMeterState } from "./meter-state.ts";

test("keeps finite percentages across a range wider than Number.MAX_VALUE", () => {
  const min = -Number.MAX_VALUE;
  const max = Number.MAX_VALUE;
  for (const [value, percent] of [
    [min, 0],
    [min / 2, 25],
    [0, 50],
    [max / 2, 75],
    [max, 100],
  ] as const) {
    const state = getMeterState({ min, max, value });
    assert.equal(state.min, min);
    assert.equal(state.max, max);
    assert.equal(state.value, value);
    assert.equal(state.percent, percent);
    assert.equal(state.invalid, false);
  }
});

test("retains thresholds and optimum within a finite overflowing span", () => {
  const state = getMeterState({
    min: -Number.MAX_VALUE,
    max: Number.MAX_VALUE,
    value: 0,
    low: -Number.MAX_VALUE / 2,
    high: Number.MAX_VALUE / 2,
    optimum: 0,
  });
  assert.equal(state.percent, 50);
  assert.equal(state.low, -Number.MAX_VALUE / 2);
  assert.equal(state.high, Number.MAX_VALUE / 2);
  assert.equal(state.range, "medium");
  assert.equal(state.optimal, true);
  assert.equal(state.state, "optimum");
  assert.equal(state.invalid, false);
});

test("retains finite native bounds when min plus one rounds back to min", () => {
  for (const min of [Number.MAX_VALUE, 2 ** 53, -(2 ** 54)]) {
    for (const max of [undefined, min, min / 2, Number.POSITIVE_INFINITY]) {
      // A greater supplied maximum is already a valid range.
      if (max !== undefined && Number.isFinite(max) && max > min) continue;
      const state = getMeterState({ min, max, value: min, low: min, high: min });
      assert.equal(state.min, min);
      assert.equal(state.max, min);
      assert.equal(state.value, min);
      assert.equal(state.low, min);
      assert.equal(state.high, min);
      assert.equal(state.percent, 0);
      assert.equal(state.state, "empty");
      assert.equal(state.invalid, true);
    }
  }
});

test("preserves ordinary repair and the smallest representable finite range", () => {
  const repaired = getMeterState({ min: 2, max: 2, value: 2.5 });
  assert.equal(repaired.min, 2);
  assert.equal(repaired.max, 3);
  assert.equal(repaired.percent, 50);
  assert.equal(repaired.invalid, true);
  for (const value of [0, Number.MIN_VALUE]) {
    const state = getMeterState({ min: 0, max: Number.MIN_VALUE, value });
    assert.equal(state.percent, value === 0 ? 0 : 100);
    assert.equal(state.invalid, false);
  }
});
