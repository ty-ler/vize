import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { sha256 } from "./docs-render-worker-resources.mjs";
import { createRenderJobs } from "../../../../docs/scripts/navigation-render-concurrency.ts";

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/** Normalize only one authenticated invocation's transport origin, preserving all URL operands. */
export function normalizeOrigin(value, origin) {
  assert(
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
    "Authenticated ephemeral static-server origin",
  );
  if (typeof value === "string")
    return value
      .split(origin)
      .map((part, index) => {
        if (index === 0) return part;
        return `${part === "" || /^[/?#"'\s<>)]/.test(part) ? "http://docs-render.invalid" : origin}${part}`;
      })
      .join("");
  if (Array.isArray(value)) return value.map((entry) => normalizeOrigin(entry, origin));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeOrigin(entry, origin)]),
    );
  return value;
}

export async function authenticateFiles(value, directory, origin, journal, files = new Map()) {
  if (Array.isArray(value))
    return Promise.all(
      value.map((entry) => authenticateFiles(entry, directory, origin, journal, files)),
    );
  if (!value || typeof value !== "object") return value;
  if (typeof value.file === "string" && typeof value.sha256 === "string") {
    const file = path.resolve(directory, value.file);
    assert(
      file.startsWith(`${directory}${path.sep}`),
      "Evidence file stays in its owning directory",
    );
    let bytes = files.get(file);
    if (!bytes) {
      bytes = await readFile(file);
      files.set(file, bytes);
    }
    assert.equal(sha256(bytes), value.sha256, `${file}: original complete carrier SHA256`);
    if (value.bytes !== undefined)
      assert.equal(bytes.length, value.bytes, `${file}: original carrier bytes`);
    if (value.file.endsWith(".html")) {
      const text = bytes.toString("utf8");
      assert.deepEqual(Buffer.from(text), bytes, `${file}: complete UTF8 HTML`);
      const canonical = Buffer.from(normalizeOrigin(text, origin));
      journal.push({
        file: value.file,
        rawSha256: value.sha256,
        rawBytes: bytes.length,
        canonicalSha256: sha256(canonical),
        canonicalBytes: canonical.length,
        replacedOrigins: text.split(origin).length - 1,
      });
      return { ...value, bytes: canonical.length, sha256: sha256(canonical) };
    }
  }
  return Object.fromEntries(
    await Promise.all(
      Object.entries(value).map(async ([key, entry]) => [
        key,
        await authenticateFiles(entry, directory, origin, journal, files),
      ]),
    ),
  );
}

/** The unselected original CLI is the authority for its complete source-specific manifest. */
export function deriveDefaultJobs(resources, timings, directory, rendererSha256) {
  assert.equal(resources.rendererSha256, rendererSha256, "Actual original renderer source bytes");
  assert.deepEqual(
    resources.argv,
    [
      "/usr/bin/time",
      "--verbose",
      "--output",
      path.join(directory, "waited-resources.txt"),
      process.execPath,
      "docs/scripts/verify-navigation-render.ts",
      "--workers",
      String(resources.workers),
      "--output",
      directory,
    ],
    "Both arms execute the complete original default CLI without route selection",
  );
  assert(Array.isArray(timings.routes) && timings.routes.length > 0);
  return createRenderJobs(timings.routes);
}

async function arm(directory, workers, rendererSha256) {
  const [receipt, timings, resources, locale, capture] = await Promise.all([
    json(path.join(directory, "receipt.json")),
    json(path.join(directory, "timings.json")),
    json(path.join(directory, "resources.json")),
    json(path.join(directory, "locale-controls/receipt.json")),
    json(path.join(directory, "capture-controls/receipt.json")),
  ]);
  for (const value of [receipt, timings, resources]) {
    assert.equal(value.status, "passed", `${workers}-worker original acceptance passed`);
    assert.equal(value.workers, workers);
  }
  const expected = deriveDefaultJobs(resources, timings, directory, rendererSha256);
  assert.equal(receipt.expectedCount, expected.length);
  const requested = expected.map(({ index, route, device }) => ({ index, route, device }));
  assert.deepEqual(receipt.requestedJobs, requested, "Every original manifest job is requested");
  assert.deepEqual(timings.requestedJobs, requested);
  assert.equal(timings.passedCount, expected.length);
  assert.equal(timings.failedCount, 0);
  assert.equal(timings.incompleteCount, 0);
  assert.deepEqual(
    receipt.reports.map(({ route, device }) => ({ route, device })),
    requested.map(({ route, device }) => ({ route, device })),
  );
  assert.equal(locale.completed, true);
  assert.equal(locale.failure, null);
  assert.equal(locale.cases.length, 8);
  const origin = new URL(locale.cases[0].html.url).origin;
  const journal = [];
  const original = { ...receipt, workers: "paired-controlled-worker-count" };
  const normalized = normalizeOrigin(
    await authenticateFiles(original, directory, origin, journal),
    origin,
  );
  const { source, ...localeControl } = locale;
  const localeNormalized = normalizeOrigin(
    {
      ...(await authenticateFiles(
        localeControl,
        path.join(directory, "locale-controls"),
        origin,
        journal,
      )),
      source: await authenticateFiles(source, process.cwd(), origin, journal),
    },
    origin,
  );
  const captureNormalized = await authenticateFiles(
    capture,
    path.join(directory, "capture-controls"),
    origin,
    journal,
  );
  assert.equal(
    resources.sourceSha,
    locale.sourceHead,
    "Whole locale/source custody uses the measured SHA",
  );
  assert.equal(resources.dist, receipt.dist);
  assert(resources.samples > 0 && resources.peakTreeRssBytes > 0 && resources.observedCpuTicks > 0);
  return {
    resources,
    routes: timings.routes,
    expected,
    normalized,
    localeNormalized,
    captureNormalized,
    journal,
  };
}

async function compare(baseline, candidate, output) {
  const result = {
    schema: "vize.docs.worker-equivalence",
    schemaVersion: 1,
    status: "failed",
    baseline,
    candidate,
  };
  let failure;
  try {
    const rendererSha256 = sha256(await readFile("docs/scripts/verify-navigation-render.ts"));
    const [two, four] = await Promise.all([
      arm(baseline, 2, rendererSha256),
      arm(candidate, 4, rendererSha256),
    ]);
    assert.deepEqual(
      four.routes,
      two.routes,
      "Every original default route and its order are retained",
    );
    assert.deepEqual(four.expected, two.expected);
    result.routes = two.routes;
    result.expectedJobs = two.expected.length;
    result.rendererSha256 = rendererSha256;
    result.sourceSha = two.resources.sourceSha;
    result.arms = [two.resources, four.resources];
    result.htmlOriginCanonicalization = [two.journal, four.journal];
    assert.equal(four.resources.sourceSha, two.resources.sourceSha);
    assert.equal(
      four.resources.siteInventorySha256,
      two.resources.siteInventorySha256,
      "Both arms consume the same whole built-site bytes",
    );
    assert.deepEqual(
      await json(path.join(baseline, "site-inventory.json")),
      await json(path.join(candidate, "site-inventory.json")),
    );
    assert.deepEqual(
      four.normalized,
      two.normalized,
      "All original route/device/theme/PNG/code/link/layout evidence is equivalent",
    );
    assert.deepEqual(
      four.localeNormalized,
      two.localeNormalized,
      "All whole original locale controls are equivalent",
    );
    assert.deepEqual(
      four.captureNormalized,
      two.captureNormalized,
      "The original capture falsification/fallback is equivalent",
    );
    result.status = "passed";
    result.durationRatio = four.resources.durationMs / two.resources.durationMs;
    result.peakTreeRssRatio = four.resources.peakTreeRssBytes / two.resources.peakTreeRssBytes;
  } catch (error) {
    failure = error;
    result.error = error.stack ?? error.message;
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  if (failure) throw failure;
  console.log(
    `Complete Docs worker equivalence: ${JSON.stringify({
      sourceSha: result.sourceSha,
      expectedJobs: result.expectedJobs,
      status: result.status,
      durationRatio: result.durationRatio,
      peakTreeRssRatio: result.peakTreeRssRatio,
    })}`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      candidate: { type: "string" },
      output: { type: "string" },
    },
  });
  assert(
    values.baseline && values.candidate && values.output,
    "--baseline, --candidate and --output are required",
  );
  await compare(
    path.resolve(values.baseline),
    path.resolve(values.candidate),
    path.resolve(values.output),
  );
}
