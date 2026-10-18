import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GRAPH_MANIFEST,
  graphDimensions,
  readNuxtUiGraphRecords,
  writeNuxtUiGraphRecords,
  type LiveGraphData,
  type GraphManifest,
  type GraphData,
  type LiveGraphSource,
} from "../_helpers/nuxt-ui-graph-records.ts";

const fixture = (): LiveGraphData => ({
  schema: 1,
  live: true,
  pid: 17,
  phase: "candidate",
  session: "session-17-a",
  graphs: [
    {
      server: 0,
      lane: { isClient: true, isServer: false },
      environment: "client",
      entries: [{ id: "/Select.vue", module: 0 }],
      modules: [
        {
          id: "/Select.vue",
          url: "/Select.vue",
          file: null,
          type: "js",
          realFile: null,
          importedModules: [0],
          importers: [0],
        },
      ],
    },
  ],
});
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function temporary(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuxt-whole-graph-records-"));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
}
function restore(root: string, manifest: GraphManifest): LiveGraphData {
  const graphs: GraphData[] = manifest.dimensions.map(({ server, lane, environment }) => ({
    ...(server === undefined ? {} : { server }),
    lane,
    environment,
    entries: [],
    modules: [],
  }));
  const value = readNuxtUiGraphRecords(root, manifest, {
    entry(graph, _index, entry) {
      graphs[graph]!.entries.push(entry);
    },
    module(graph, _index, module) {
      graphs[graph]!.modules.push({ ...module, importedModules: [], importers: [] });
    },
    edge(graph, module, direction, _index, target) {
      graphs[graph]!.modules[module]![direction].push(target);
    },
  });
  return {
    schema: value.schema,
    live: value.live,
    pid: value.pid,
    phase: value.phase,
    session: value.session,
    graphs,
  };
}

const expected =
  [
    '{"kind":"header","value":{"schema":1,"live":true,"pid":17,"phase":"candidate","session":"session-17-a"}}',
    '{"kind":"graph","graph":0,"value":{"server":0,"lane":{"isClient":true,"isServer":false},"environment":"client"}}',
    '{"kind":"entry","graph":0,"index":0,"value":{"id":"/Select.vue","module":0}}',
    '{"kind":"module","graph":0,"index":0,"value":{"id":"/Select.vue","url":"/Select.vue","file":null,"type":"js","realFile":null}}',
    '{"kind":"edge","graph":0,"module":0,"direction":"importedModules","index":0,"target":0}',
    '{"kind":"edge","graph":0,"module":0,"direction":"importers","index":0,"target":0}',
    '{"kind":"moduleEnd","graph":0,"module":0,"importedModules":1,"importers":1}',
    '{"kind":"end"}',
  ].join("\n") + "\n";

test("ordered graph transport retains every complete field and independent whole wire bytes", () =>
  temporary((root) => {
    const original = fixture(),
      manifest = writeNuxtUiGraphRecords(root, original);
    const bytes = fs.readFileSync(path.join(root, manifest.file));
    assert.equal(bytes.toString(), expected);
    assert.equal(manifest.sha256, hash(expected));
    assert.equal(manifest.bytes, Buffer.byteLength(expected));
    assert.equal(manifest.rows, 8);
    assert.deepEqual(restore(root, manifest), original);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, GRAPH_MANIFEST), "utf8")),
      manifest,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, "module-graphs-live-dimensions.json"), "utf8")),
      graphDimensions(original),
    );
  }));

test("streamed records retain long Unicode identifiers, duplicate entries, complete edges and both lanes", () =>
  temporary((root) => {
    const original = fixture();
    const text = "/" + "模块😀\n\r\ud800".repeat(30_000);
    original.graphs[0]!.modules[0]!.id = text;
    original.graphs[0]!.modules[0]!.url = text;
    original.graphs[0]!.entries.push({ id: text, module: 0 });
    original.graphs.push({
      ...structuredClone(original.graphs[0]!),
      server: 1,
      lane: { isClient: false, isServer: true },
      environment: "ssr",
    });
    const manifest = writeNuxtUiGraphRecords(root, original);
    assert.ok(manifest.bytes > 64 * 1024);
    assert.deepEqual(
      restore(root, JSON.parse(fs.readFileSync(path.join(root, GRAPH_MANIFEST), "utf8"))),
      original,
    );
    assert.equal(manifest.dimensions[0]!.fields["module.id"]!.maximum, text.length);
    assert.equal(manifest.dimensions[1]!.entries, 2);
  }));

test("truncation, trailing records and changed bytes refuse even after a forged matching digest", () =>
  temporary((root) => {
    for (const content of [
      expected.slice(0, -1),
      expected.replace('{"kind":"end"}\n', ""),
      expected + '{"kind":"end"}\n',
      expected.replace('"index":0', '"index":1'),
      expected.replace(/^.*"kind":"edge".*\n/m, ""),
      expected.replace(/^(.*"kind":"edge".*\n)/m, "$1$1"),
      expected.replace('"target":0', '"target":99'),
      expected.replace('"kind":"end"', '"kind":"end","unknown":1'),
    ]) {
      const manifest = writeNuxtUiGraphRecords(root, fixture());
      fs.writeFileSync(path.join(root, manifest.file), content);
      assert.throws(() =>
        readNuxtUiGraphRecords(root, {
          ...manifest,
          bytes: Buffer.byteLength(content),
          sha256: hash(content),
          rows: content.split("\n").length - 1,
        }),
      );
    }
    const manifest = writeNuxtUiGraphRecords(root, fixture());
    fs.writeFileSync(
      path.join(root, manifest.file),
      expected.replace("/Select.vue", "/Alterx.vue"),
    );
    assert.throws(() => readNuxtUiGraphRecords(root, manifest), /content hash|byte count/);
  }));

test("manifest process identity, dimensions and owned file cannot be substituted", () =>
  temporary((root) => {
    const manifest = writeNuxtUiGraphRecords(root, fixture());
    assert.throws(
      () => readNuxtUiGraphRecords(root, { ...manifest, phase: "reference" }),
      /process identity/,
    );
    assert.throws(
      () => readNuxtUiGraphRecords(root, { ...manifest, bytes: manifest.bytes + 1 }),
      /byte count/,
    );
    assert.throws(() => readNuxtUiGraphRecords(root, { ...manifest, rows: 4 }), /record count/);
    const altered = structuredClone(manifest);
    altered.dimensions[0]!.importedEdges++;
    assert.throws(() => readNuxtUiGraphRecords(root, altered), /dimensional parity/);
    assert.throws(
      () =>
        readNuxtUiGraphRecords(root, { ...manifest, file: "../foreign" as typeof manifest.file }),
      /owned graph file/,
    );
  }));

test("dimensional evidence precedes a source traversal failure and no success manifest is published", () =>
  temporary((root) => {
    const original = fixture();
    writeNuxtUiGraphRecords(root, original);
    let reads = 0;
    Object.defineProperty(original.graphs[0]!.modules[0]!, "id", {
      enumerable: true,
      get() {
        if (++reads === 2) throw new RangeError("authored traversal refusal");
        return "/Select.vue";
      },
    });
    assert.throws(() => writeNuxtUiGraphRecords(root, original), /authored traversal refusal/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, "module-graphs-live-dimensions.json"), "utf8")),
      graphDimensions(original),
    );
    assert.equal(fs.existsSync(path.join(root, GRAPH_MANIFEST)), false);
    assert.equal(
      fs.readFileSync(path.join(root, "module-graphs-live.ndjson"), "utf8"),
      expected.split("\n").slice(0, 3).join("\n") + "\n",
      "all already-generated pending records flush before the original traversal failure is rethrown",
    );
  }));

test("large reusable edge iterables stream in order without array serialization or reconstruction", () =>
  temporary((root) => {
    const original = fixture(),
      module = original.graphs[0]!.modules[0]!;
    const edges = {
      *[Symbol.iterator]() {
        for (let index = 0; index < 50_000; index++) yield 0;
      },
      toJSON() {
        assert.fail("edge aggregate must never be serialized");
      },
    };
    const source: LiveGraphSource = {
      ...original,
      graphs: [{ ...original.graphs[0]!, modules: [{ ...module, importedModules: edges }] }],
    };
    const manifest = writeNuxtUiGraphRecords(root, source);
    let count = 0;
    const summary = readNuxtUiGraphRecords(root, manifest, {
      edge(graph, module, direction, index, target) {
        assert.equal(graph, 0);
        assert.equal(module, 0);
        assert.equal(target, 0);
        if (direction === "importedModules") assert.equal(index, count++);
      },
    });
    assert.equal(count, 50_000);
    assert.equal(summary.graphs[0]!.importedEdges, 50_000);
    assert.equal(
      typeof summary.graphs[0]!.modules,
      "number",
      "production verifier retains counts, not aggregate modules or edges",
    );
  }));
