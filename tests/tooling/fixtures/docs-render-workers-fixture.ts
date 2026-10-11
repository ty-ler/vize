import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createRenderJobs } from "../../../docs/scripts/navigation-render-concurrency.ts";
import { defaultNavigationRenderRoutes } from "../../../docs/scripts/navigation-render-routes.ts";
import { localeSourceFiles } from "../../../docs/scripts/navigation-render-workers-evidence.ts";

export const fixtureSource = "a".repeat(40);
export const fixtureExpected = {
  source: fixtureSource,
  dist: "/same/physical/dist",
  sourceFiles: localeSourceFiles.map((file, index) => ({
    file,
    bytes: index + 1,
    sha256: "c".repeat(64),
  })),
};
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function writePacket(dir: string, file: string, value: unknown) {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), JSON.stringify(value) + "\n");
}
function png(width: number, height: number) {
  function chunk(type: string, data: Buffer) {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const trailer = Buffer.alloc(4);
    trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, trailer]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Authored complete packet fixture; real browser execution remains a separate law. */
export async function prepareWorkersArm(dir: string, workers: 2 | 4) {
  await mkdir(dir, { recursive: true });
  const origin = `http://127.0.0.1:${workers === 2 ? 41002 : 41004}`;
  const jobs = createRenderJobs(defaultNavigationRenderRoutes);
  const requestedJobs = jobs.map(({ index, route, device }) => ({ index, route, device }));
  const events: Record<string, unknown>[] = [];
  const pngs = new Map<string, Buffer>();
  async function capture(
    name: string,
    job: { index: number | null; route: string; device: string },
    width: number,
    height: number,
    base = "",
  ) {
    const viewportHeight = base ? 844 : height;
    const tops = [0];
    if (base)
      while (tops.at(-1)! + viewportHeight < height)
        tops.push(Math.min(tops.at(-1)! + viewportHeight - 1, height - viewportHeight));
    const tiles = [];
    const phases: Record<string, unknown>[] = [
      { phase: "initial-viewport-scroll" },
      { phase: "prepare" },
    ];
    const layout = base
      ? {
          descendants: 2,
          elements: 1,
          textNodes: 1,
          rectangles: 1,
          beforeSha256: "a".repeat(64),
          afterSha256: "b".repeat(64),
          identical: false,
          originalViewportHeight: 844,
          captureViewportHeight: 844,
        }
      : undefined;
    if (layout)
      phases.push(
        ...[
          "layout-before",
          "viewport-enlarge",
          "layout-after-proof",
          "enlarged-dimensions",
          "fallback-restore",
          "fallback-proof",
        ].map((phase) => ({ phase })),
      );
    for (const [tileIndex, top] of tops.entries()) {
      const file = base
        ? name.replace(/\.png$/, `-tile-${String(tileIndex).padStart(3, "0")}.png`)
        : name;
      const key = `${width}:${viewportHeight}`;
      if (!pngs.has(key)) pngs.set(key, png(width, viewportHeight));
      const bytes = pngs.get(key)!;
      await mkdir(path.join(dir, base), { recursive: true });
      await writeFile(path.join(dir, base, file), bytes);
      tiles.push({ top, height: viewportHeight, file, sha256: hash(bytes) });
      phases.push(
        { phase: "tile-position", tileIndex, top },
        {
          phase: "screenshot-call-inclusive-write",
          tileIndex,
          top,
          file,
          width,
          height: viewportHeight,
          viewportHeight,
        },
        { phase: "png-validation-hash", tileIndex, top, file },
      );
    }
    phases.push(
      ...["final-coverage-layout", "restore-viewport", "restore-scroll", "snapshot-dispose"].map(
        (phase) => ({ phase }),
      ),
    );
    events.push(
      ...phases.map((phase, index) => ({
        jobIndex: job.index,
        route: job.route,
        device: job.device,
        capture: name,
        ...phase,
        startMs: index * 2,
        durationMs: 1,
        status: "passed",
      })),
    );
    return {
      width,
      viewportHeight,
      height,
      mode: base ? "overlapping-viewports" : "full-page",
      ...(layout ? { layout } : {}),
      tiles,
    };
  }
  const reports = [];
  for (const job of jobs) {
    const initial = await capture(job.screenshot, job, job.viewport.width, job.viewport.height);
    const themed =
      /^\/(?:ja\/|zh-CN\/|pt-BR\/|fr\/)?rules\//.test(job.route) ||
      /\/(?:guide\/content-mapper|getting-started)$/.test(job.route) ||
      ["/", "/ja/"].includes(job.route);
    const themeScreenshots = [];
    if (themed) {
      themeScreenshots.push({
        theme: "light",
        screenshot: job.screenshot,
        capture: initial,
        controlSelector: ".theme-toggle",
        codeContrast: {},
      });
      const screenshot = job.screenshot.replace(/\.png$/, "-dark.png");
      themeScreenshots.push({
        theme: "dark",
        screenshot,
        capture: await capture(screenshot, job, job.viewport.width, job.viewport.height),
        controlSelector: ".theme-toggle",
        codeContrast: {},
      });
    }
    reports.push({
      route: job.route,
      device: job.device,
      screenshot: job.screenshot,
      capture: initial,
      themeScreenshots,
      pageErrors: [],
      title: "Whole authored corpus",
      viewport: job.viewport.width,
      bodyWidth: job.viewport.width,
      images: [],
      goals: [],
      groups: [],
      tables: [],
      links: [
        `${origin}/linked/?same%20query#same-hash`,
        "https://example.com/untouched?q=1#original",
      ],
      tableCode: [],
      codeContrast: {},
      japaneseFonts: [{ familyName: "Noto Sans CJK JP", glyphCount: 4 }],
      rulePackets: [],
      authoredJapanese: null,
    });
  }
  const controlCapture = await capture(
    "viewport-sensitive.png",
    { index: null, route: "capture-controls", device: "control" },
    390,
    10000,
    "capture-controls",
  );
  await writePacket(dir, "capture-controls/receipt.json", {
    before: { source: "<p>control</p>", elements: [[0, 0, 320, 48]], text: [[0, 0, 10, 12]] },
    enlarged: { source: "<p>control</p>", elements: [[0, 0, 320, 48]], text: [[0, 0, 100, 120]] },
    capture: controlCapture,
  });
  const cases = [];
  for (const device of ["desktop", "mobile"])
    for (const locale of ["en", "ja"])
      for (const theme of ["light", "dark"]) {
        const name = `${locale}-${device}-${theme}`;
        await mkdir(path.join(dir, "locale-controls"), { recursive: true });
        const html = "<!doctype html><h1>Whole original source</h1>";
        const htmlReceipt = (file: string) => ({
          file,
          bytes: Buffer.byteLength(html),
          sha256: hash(html),
          url: `${origin}/${locale}/getting-started/index.html?query%20state#original`,
        });
        await writeFile(path.join(dir, "locale-controls", `${name}.html`), html);
        await writeFile(path.join(dir, "locale-controls", `${name}-final.html`), html);
        const bytes = png(1, 1);
        await writeFile(path.join(dir, "locale-controls", `${name}.png`), bytes);
        cases.push({
          name,
          errors: [],
          html: htmlReceipt(`${name}.html`),
          finalSource: htmlReceipt(`${name}-final.html`),
          screenshot: { file: `${name}.png`, bytes: bytes.length, sha256: hash(bytes) },
          metrics: {},
          controls: theme === "light" ? {} : null,
          liveLinks:
            theme === "light"
              ? { nativeTarget: `${origin}/ja/index.html?native%20state#full` }
              : null,
          responsive: name === "en-desktop-light" ? {} : null,
        });
      }
  await writePacket(dir, "locale-controls/receipt.json", {
    sourceHead: fixtureSource,
    workflow: { sha: fixtureSource, run: "1", attempt: "1" },
    source: fixtureExpected.sourceFiles,
    completed: true,
    failure: null,
    cases,
  });
  const startedAt = new Date("2026-10-12T00:00:00Z").toISOString();
  const phases = [
    "context",
    "navigation",
    "assets",
    "japanese-fonts",
    "metrics",
    "table-code",
    "navigation-assertions",
    "theme-readability",
    "rule-packets",
    "command-tabs",
    "layout",
    "links",
    "capture",
    "theme-captures",
    "context-close",
  ];
  const timings = jobs.map((job) => {
    const start = Date.parse(startedAt) + Math.floor(job.index / workers) * 10000;
    return {
      index: job.index,
      route: job.route,
      device: job.device,
      worker: job.index % workers,
      startedAt: new Date(start).toISOString(),
      durationMs: 281,
      status: "passed",
      phases: phases.map((phase, index) => ({
        phase,
        startedAt: new Date(start + index * 20).toISOString(),
        durationMs: 1,
        status: "passed",
      })),
    };
  });
  await writePacket(dir, "receipt.json", {
    dist: "/same/physical/dist",
    status: "passed",
    workers,
    expectedCount: 238,
    requestedJobs,
    reports,
  });
  await writePacket(dir, "timings.json", {
    schemaVersion: 1,
    dist: "/same/physical/dist",
    status: "passed",
    workers,
    expectedCount: 238,
    requestedJobs,
    routes: defaultNavigationRenderRoutes,
    startedAt,
    durationMs: workers === 2 ? 1190000 : 600000,
    passedCount: 238,
    failedCount: 0,
    incompleteCount: 0,
    phases: ["browser-launch", "capture-controls", "browser-close", "server-close"].map(
      (phase) => ({ phase, startedAt, durationMs: 1, status: "passed" }),
    ),
    jobs: timings,
  });
  await writePacket(dir, "capture-timings.json", {
    schemaVersion: 1,
    source: fixtureSource,
    dist: "/same/physical/dist",
    status: "passed",
    workers,
    startedAt,
    scope: path.basename(dir),
    timeOrigin: 1,
    screenshotIncludesPreparationEncodingTransferAndPngWrite: true,
    events,
  });
}
