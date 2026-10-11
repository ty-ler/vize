import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { RenderJob } from "./navigation-render-concurrency.ts";
import { treeCustody } from "./navigation-render-workers-custody.ts";
import { usesInstalledCjkFont } from "./japanese-font-usage.ts";
import { list, number, packet, text } from "./navigation-render-workers-packets.ts";
import type { Packet } from "./navigation-render-workers-packets.ts";

function captureKey(index: unknown, name: string) {
  assert(
    index === null || (Number.isInteger(index) && number(index) < 238),
    "Exact capture job index required",
  );
  return `${index === null ? "control" : number(index)}:${name}`;
}

export async function workersCaptureEvidence(
  dir: string,
  jobs: RenderJob[],
  receipt: Packet,
  captures: Packet,
  control: Packet,
  localeCases: Packet[],
) {
  const assets = new Map<string, Packet>();
  const captureNames = new Map<string, Packet>();
  function capture(value: unknown, base: string, identity: Packet, name: string) {
    const authority = packet(value);
    const width = number(authority.width);
    const height = number(authority.height);
    assert(width > 0 && height > 0 && number(authority.viewportHeight) > 0);
    const tiles = list(authority.tiles).map(packet);
    assert(tiles.length > 0);
    assert.equal(tiles[0].top, 0, "Initial page pixels required");
    assert.equal(
      number(tiles.at(-1)!.top) + number(tiles.at(-1)!.height),
      height,
      "Final page pixels required",
    );
    for (const [index, tile] of tiles.entries()) {
      if (index)
        assert(
          number(tile.top) > number(tiles[index - 1].top) &&
            number(tile.top) < number(tiles[index - 1].top) + number(tiles[index - 1].height),
          "Complete overlapping pixel coverage",
        );
      assert.match(text(tile.file), /^[a-zA-Z0-9_-]+\.png$/);
      assets.set(path.posix.join(base, text(tile.file)), { ...tile, width });
    }
    assert(["full-page", "overlapping-viewports"].includes(text(authority.mode)));
    if (authority.mode === "full-page") assert.equal(tiles.length, 1);
    if (authority.layout !== undefined) {
      const layout = packet(authority.layout);
      for (const field of ["descendants", "elements", "textNodes", "rectangles"])
        number(layout[field]);
      assert.match(text(layout.beforeSha256), /^[a-f0-9]{64}$/);
      assert.match(text(layout.afterSha256), /^[a-f0-9]{64}$/);
      if (layout.identical === true) assert.equal(layout.beforeSha256, layout.afterSha256);
    }
    const key = captureKey(identity.jobIndex, name);
    if (captureNames.has(key))
      assert.deepEqual(captureNames.get(key), { ...identity, capture: name, authority });
    else captureNames.set(key, { ...identity, capture: name, authority });
  }
  const reports = list(receipt.reports).map(packet);
  assert.equal(reports.length, 238);
  for (const [index, report] of reports.entries()) {
    const job = jobs[index];
    assert.equal(report.route, job.route);
    assert.equal(report.device, job.device);
    assert.equal(report.screenshot, job.screenshot);
    for (const field of [
      "tableCode",
      "codeContrast",
      "title",
      "viewport",
      "bodyWidth",
      "images",
      "goals",
      "groups",
      "tables",
      "links",
      "japaneseFonts",
      "rulePackets",
      "authoredJapanese",
      "themeScreenshots",
    ])
      assert(Object.hasOwn(report, field), `Missing original ${field} authority`);
    assert.deepEqual(report.pageErrors, []);
    if (job.route === "/ja/" || job.route.startsWith("/ja/")) {
      const fonts = list(report.japaneseFonts)
        .map(packet)
        .map((font) => ({
          familyName: text(font.familyName),
          glyphCount: number(font.glyphCount),
        }));
      assert(
        fonts.some((font) => font.glyphCount > 0) && usesInstalledCjkFont(fonts),
        "Original installed Japanese glyph provider required",
      );
    }
    assert.equal(packet(report.capture).width, job.viewport.width);
    const identity = { jobIndex: index, route: job.route, device: job.device };
    capture(report.capture, "", identity, text(report.screenshot));
    const themes = list(report.themeScreenshots).map(packet);
    const themed =
      /^\/(?:ja\/|zh-CN\/|pt-BR\/|fr\/)?rules\//.test(job.route) ||
      /\/(?:guide\/content-mapper|getting-started)$/.test(job.route) ||
      ["/", "/ja/"].includes(job.route);
    assert.deepEqual(
      themes.map((theme) => theme.theme),
      themed ? ["light", "dark"] : [],
      "Every original theme capture boundary required",
    );
    for (const theme of themes) capture(theme.capture, "", identity, text(theme.screenshot));
  }
  assert.equal(packet(packet(control.capture).layout).identical, false);
  assert.equal(packet(control.before).source, packet(control.enlarged).source);
  assert.deepEqual(packet(control.before).elements, packet(control.enlarged).elements);
  assert.notDeepEqual(
    packet(control.before).text,
    packet(control.enlarged).text,
    "Actual text-range negative control required",
  );
  assert.equal(packet(packet(control.capture).layout).captureViewportHeight, 844);
  assert.equal(packet(control.capture).height, 10000);
  capture(
    control.capture,
    "capture-controls",
    { jobIndex: null, route: "capture-controls", device: "control" },
    "viewport-sensitive.png",
  );
  for (const entry of localeCases) {
    assert.deepEqual(entry.errors, []);
    for (const field of ["html", "screenshot", "finalSource"]) {
      const value = packet(entry[field]);
      const file = text(value.file);
      assert.match(file, /^[a-zA-Z0-9_-]+\.(?:png|html)$/);
      assets.set(`locale-controls/${file}`, value);
    }
    assert(entry.metrics !== null, "Original locale metrics required");
    if (text(entry.name).endsWith("-light"))
      assert(
        entry.controls !== null && entry.liveLinks !== null,
        "Original locale native controls required",
      );
  }
  const events = list(captures.events).map(packet);
  const grouped = new Map<string, Packet[]>();
  for (const event of events) {
    assert.equal(event.status, "passed", "Every original capture operation must finish");
    number(event.startMs);
    number(event.durationMs);
    const key = captureKey(event.jobIndex, text(event.capture));
    const authority = captureNames.get(key);
    assert(
      authority && event.route === authority.route && event.device === authority.device,
      "Capture event source/job identity required",
    );
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  assert.deepEqual(
    [...grouped.keys()].sort(),
    [...captureNames.keys()].sort(),
    "Every initial/theme/control capture is timed",
  );
  const normalizedEvents = [];
  for (const [key, group] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const authority = packet(captureNames.get(key)!.authority);
    const expected = ["initial-viewport-scroll", "prepare"];
    if (authority.layout !== undefined) {
      expected.push(
        "layout-before",
        "viewport-enlarge",
        "layout-after-proof",
        "enlarged-dimensions",
      );
      if (packet(authority.layout).identical === false)
        expected.push("fallback-restore", "fallback-proof");
    }
    const tiles = list(authority.tiles).map(packet);
    for (const [index, tile] of tiles.entries()) {
      expected.push("tile-position", "screenshot-call-inclusive-write", "png-validation-hash");
      const window = group.filter((event) => event.tileIndex === index);
      assert.deepEqual(
        window.map((event) => event.phase),
        ["tile-position", "screenshot-call-inclusive-write", "png-validation-hash"],
        "Separate original scroll and screenshot/hash boundaries required",
      );
      assert(window.every((event) => event.top === tile.top));
      assert.equal(window[1].file, tile.file);
      assert.equal(window[2].file, tile.file);
    }
    expected.push(
      "final-coverage-layout",
      "restore-viewport",
      "restore-scroll",
      "snapshot-dispose",
    );
    assert.deepEqual(
      group.map((event) => event.phase),
      expected,
      "Every separate original capture checkpoint required",
    );
    for (let index = 1; index < group.length; index++)
      assert(
        number(group[index].startMs) >=
          number(group[index - 1].startMs) + number(group[index - 1].durationMs),
        "Capture operation order remains exact",
      );
    normalizedEvents.push(
      ...group.map(({ startMs: _start, durationMs: _duration, ...event }) => event),
    );
  }
  for (const [relative, authority] of assets) {
    const file = path.join(dir, relative);
    assert(
      !(await lstat(file)).isSymbolicLink() && (await realpath(file)) === file,
      "Physical original capture file required",
    );
    const bytes = await readFile(file);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      authority.sha256,
      `Raw file custody: ${relative}`,
    );
    if (authority.bytes !== undefined) assert.equal(bytes.length, authority.bytes);
    if (authority.width !== undefined) {
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), authority.width);
      assert.equal(bytes.readUInt32BE(20), authority.height);
    }
  }
  const rawFiles = (await treeCustody(dir))
    .filter(({ file }) => /\.(png|html)$/.test(file))
    .map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 }));
  assert.deepEqual(
    rawFiles.map(({ file }) => file).sort(),
    [...assets.keys()].sort(),
    "Complete original raw image/HTML membership required",
  );
  return { reports, normalizedEvents, rawFiles };
}
