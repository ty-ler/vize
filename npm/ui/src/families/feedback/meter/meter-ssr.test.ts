import assert from "node:assert/strict";

import { test } from "vite-plus/test";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";

import Meter from "./meter.vue";

const SsrProbe = defineComponent({
  name: "MeterSsrProbe",
  setup() {
    return () =>
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
      );
  },
});

test("renders byte-identical native meter markup across isolated SSR requests", async () => {
  const outputs = await Promise.all([
    renderToString(createSSRApp(SsrProbe)),
    renderToString(createSSRApp(SsrProbe)),
  ]);
  assert.equal(outputs[0], outputs[1]);
  const html = outputs[0] ?? "";
  assert.match(html, /^<meter/);
  assert.match(html, /id="storage-meter"/);
  assert.match(html, /value="64"/);
  assert.match(html, /min="0"/);
  assert.match(html, /max="100"/);
  assert.match(html, /low="30"/);
  assert.match(html, /high="90"/);
  assert.match(html, /optimum="50"/);
  assert.match(html, /aria-label="Storage usage"/);
  assert.match(html, /data-vize-ui="meter"/);
  assert.match(html, /data-state="optimum"/);
  assert.match(html, /64%/);
  assert.doesNotMatch(html, /aria-live|tabindex|function/);
});

test("renders repaired invalid server markup without unsafe threshold attributes", async () => {
  const html = await renderToString(
    createSSRApp({
      name: "MeterInvalidSsrProbe",
      setup() {
        return () =>
          h(Meter, {
            ariaLabel: "Quota usage",
            high: Number.NaN,
            max: 0,
            optimum: Number.POSITIVE_INFINITY,
            value: Number.NaN,
          });
      },
    }),
  );

  assert.match(html, /^<meter/);
  assert.match(html, /value="0"/);
  assert.match(html, /min="0"/);
  assert.match(html, /max="1"/);
  assert.match(html, /data-invalid="true"/);
  assert.doesNotMatch(html, /high="NaN"|optimum="Infinity"/);
});

test("renders finite wide and collapsed ranges identically across SSR requests", async () => {
  for (const [min, max, value, percent, invalid] of [
    [-Number.MAX_VALUE, Number.MAX_VALUE, 0, 50, false],
    [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 100, false],
    [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 0, true],
  ] as const) {
    const probe = {
      setup: () => () => h(Meter, { id: "finite-meter", min, max, value }),
    };
    const first = await renderToString(createSSRApp(probe));
    const second = await renderToString(createSSRApp(probe));
    assert.equal(first, second);
    assert.ok(first.includes(`min="${min}"`));
    assert.ok(first.includes(`max="${max}"`));
    assert.ok(first.includes(`value="${value}"`));
    assert.ok(first.includes(`data-percent="${percent}"`));
    assert.equal(first.includes('data-invalid="true"'), invalid);
    assert.doesNotMatch(first, /NaN|Infinity/);
  }
});
