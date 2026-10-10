import assert from "node:assert/strict";

import { h } from "vue";

import Meter from "./meter.vue";
import type { RuntimeFixture } from "../../../conformance/runtime-conformance-fixtures.ts";

export const meterRuntimeFixture: RuntimeFixture = {
  name: "meter",
  sourceFile: "families/feedback/meter/meter.vue",
  render: () =>
    h(
      Meter,
      {
        ariaLabel: "Storage usage",
        high: 90,
        id: "storage-meter",
        low: 30,
        max: 100,
        optimum: 50,
        value: 64,
      },
      {
        default: () => "64%",
      },
    ),
  assertServerMarkup(html) {
    assert.match(html, /^<meter/);
    assert.match(html, /id="storage-meter"/);
    assert.match(html, /value="64"/);
    assert.match(html, /max="100"/);
    assert.match(html, /low="30"/);
    assert.match(html, /high="90"/);
    assert.match(html, /optimum="50"/);
    assert.match(html, /aria-label="Storage usage"/);
    assert.match(html, /data-vize-ui="meter"/);
    assert.match(html, /data-state="optimum"/);
  },
  assertHydratedDom(host) {
    const meter = host.querySelector('[data-vize-ui="meter"]');
    assert.ok(meter instanceof HTMLMeterElement);
    assert.equal(meter.id, "storage-meter");
    assert.equal(meter.getAttribute("value"), "64");
    assert.equal(meter.getAttribute("max"), "100");
    assert.equal(meter.getAttribute("low"), "30");
    assert.equal(meter.getAttribute("high"), "90");
    assert.equal(meter.getAttribute("optimum"), "50");
    assert.equal(meter.getAttribute("data-state"), "optimum");
    assert.equal(meter.textContent, "64%");
  },
};

function finiteRangeFixture(
  name: string,
  min: number,
  max: number,
  value: number,
  percent: number,
  invalid: boolean,
): RuntimeFixture {
  return {
    name,
    sourceFile: "families/feedback/meter/meter.vue",
    render: () =>
      h(
        Meter,
        { ariaLabel: "Signed measurement", id: name, min, max, value },
        { default: () => `${percent}%` },
      ),
    assertServerMarkup(html) {
      assert.match(html, /^<meter/);
      assert.ok(html.includes(`min="${min}"`));
      assert.ok(html.includes(`max="${max}"`));
      assert.ok(html.includes(`value="${value}"`));
      assert.ok(html.includes(`data-percent="${percent}"`));
      assert.equal(html.includes('data-invalid="true"'), invalid);
      assert.doesNotMatch(html, /NaN|Infinity/);
    },
    assertHydratedDom(host) {
      const meter = host.querySelector('[data-vize-ui="meter"]');
      assert.ok(meter instanceof HTMLMeterElement);
      assert.equal(meter.getAttribute("min"), String(min));
      assert.equal(meter.getAttribute("max"), String(max));
      assert.equal(meter.getAttribute("value"), String(value));
      assert.equal(meter.getAttribute("data-percent"), String(percent));
      assert.equal(meter.getAttribute("data-invalid"), invalid ? "true" : null);
      assert.equal(meter.textContent, `${percent}%`);
    },
  };
}

export const meterRuntimeFixtures: readonly RuntimeFixture[] = [
  meterRuntimeFixture,
  finiteRangeFixture("meter-wide-range", -Number.MAX_VALUE, Number.MAX_VALUE, 0, 50, false),
  finiteRangeFixture(
    "meter-collapsed-range",
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    0,
    true,
  ),
];
