import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

type Scalars = {
  id: string | null;
  url: string;
  file: string | null;
  type: string | null;
  realFile: string | null;
};
type Entry = { id: string; module: number };
type Metadata = {
  server?: number;
  lane: { isClient?: boolean; isServer?: boolean };
  environment: string | null;
};
export type GraphData = Metadata & {
  entries: Entry[];
  modules: (Scalars & { importedModules: number[]; importers: number[] })[];
};
export type GraphSource = Metadata & {
  entries: Iterable<Entry>;
  modules: Iterable<Scalars & { importedModules: Iterable<number>; importers: Iterable<number> }>;
};
type Identity = { schema: number; live: boolean; pid: number; phase: string; session: string };
export type LiveGraphData = Identity & { graphs: GraphData[] };
export type LiveGraphSource = Identity & { graphs: GraphSource[] };
const FILE = "module-graphs-live.ndjson";
const CHUNK_BYTES = 64 * 1024;
export const GRAPH_MANIFEST = "module-graphs-live-manifest.json";
const scalarFields = ["id", "url", "file", "type", "realFile"] as const;
const directions = ["importedModules", "importers"] as const;
type Direction = (typeof directions)[number];
function dimensions(metadata: Metadata) {
  return {
    ...metadata,
    entries: 0,
    modules: 0,
    importedEdges: 0,
    importerEdges: 0,
    fields: {} as Record<string, { count: number; utf16: number; maximum: number }>,
  };
}
type Dimensions = ReturnType<typeof dimensions>;
function measure(total: Dimensions, field: string, value: string | null) {
  assert.ok(value === null || typeof value === "string", `${field}: exact string or null required`);
  const size = (total.fields[field] ??= { count: 0, utf16: 0, maximum: 0 });
  size.count++;
  size.utf16 += value?.length ?? 0;
  size.maximum = Math.max(size.maximum, value?.length ?? 0);
}
function metadata(graph: Metadata): Metadata {
  return {
    ...(graph.server === undefined ? {} : { server: graph.server }),
    lane: graph.lane,
    environment: graph.environment,
  };
}
export function graphDimensions(record: LiveGraphSource) {
  return record.graphs.map((graph) => {
    const total = dimensions(metadata(graph));
    for (const entry of graph.entries) {
      total.entries++;
      measure(total, "entry.id", entry.id);
    }
    for (const module of graph.modules) {
      total.modules++;
      for (const field of scalarFields) measure(total, `module.${field}`, module[field]);
      for (const _edge of module.importedModules) total.importedEdges++;
      for (const _edge of module.importers) total.importerEdges++;
    }
    return total;
  });
}
export type GraphManifest = Identity & {
  transport: "ordered-graph-records-v1";
  capture: string;
  file: typeof FILE;
  bytes: number;
  sha256: string;
  rows: number;
  dimensions: Dimensions[];
};
type Wire =
  | { kind: "header"; value: Identity }
  | { kind: "graph"; graph: number; value: Metadata }
  | { kind: "entry"; graph: number; index: number; value: Entry }
  | { kind: "module"; graph: number; index: number; value: Scalars }
  | {
      kind: "edge";
      graph: number;
      module: number;
      direction: Direction;
      index: number;
      target: number;
    }
  | { kind: "moduleEnd"; graph: number; module: number; importedModules: number; importers: number }
  | { kind: "end" };

export function writeNuxtUiGraphRecords(directory: string, record: LiveGraphSource): GraphManifest {
  const counts = graphDimensions(record);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "module-graphs-live-dimensions.json"),
    JSON.stringify(counts),
  );
  fs.rmSync(path.join(directory, GRAPH_MANIFEST), { force: true });
  const descriptor = fs.openSync(path.join(directory, FILE), "w"),
    hash = createHash("sha256");
  let bytes = 0,
    rows = 0,
    buffered = 0;
  let pending: Buffer[] = [];
  const flush = () => {
    if (buffered === 0) return;
    const data = Buffer.concat(pending, buffered);
    pending = [];
    buffered = 0;
    fs.writeFileSync(descriptor, data);
  };
  const write = (row: Wire) => {
    const data = Buffer.from(`${JSON.stringify(row)}\n`);
    if (buffered + data.length > CHUNK_BYTES) flush();
    if (data.length >= CHUNK_BYTES) fs.writeFileSync(descriptor, data);
    else {
      pending.push(data);
      buffered += data.length;
    }
    hash.update(data);
    bytes += data.length;
    rows++;
  };
  let failed = false,
    failure: unknown;
  const cleanupFailures: unknown[] = [];
  const { graphs, ...header } = record;
  try {
    write({ kind: "header", value: header });
    flush();
    for (const [graph, value] of graphs.entries()) {
      write({ kind: "graph", graph, value: metadata(value) });
      let index = 0;
      for (const entry of value.entries)
        write({ kind: "entry", graph, index: index++, value: entry });
      index = 0;
      for (const { importedModules, importers, ...scalar } of value.modules) {
        write({ kind: "module", graph, index, value: scalar });
        const counts = { importedModules: 0, importers: 0 };
        for (const direction of directions)
          for (const target of direction === "importedModules" ? importedModules : importers)
            write({
              kind: "edge",
              graph,
              module: index,
              direction,
              index: counts[direction]++,
              target,
            });
        write({ kind: "moduleEnd", graph, module: index++, ...counts });
      }
    }
    write({ kind: "end" });
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      flush();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (failed) {
    if (cleanupFailures.length)
      throw new AggregateError([failure, ...cleanupFailures], "graph producer and cleanup failed", {
        cause: failure,
      });
    throw failure;
  }
  if (cleanupFailures.length)
    throw new AggregateError(cleanupFailures, "graph output cleanup failed");
  const manifest: GraphManifest = {
    ...header,
    transport: "ordered-graph-records-v1",
    capture: path.basename(directory),
    file: FILE,
    bytes,
    rows,
    sha256: hash.digest("hex"),
    dimensions: counts,
  };
  fs.writeFileSync(path.join(directory, GRAPH_MANIFEST), JSON.stringify(manifest));
  return manifest;
}

const wireKeys: Record<Wire["kind"], string[]> = {
  header: ["kind", "value"],
  graph: ["graph", "kind", "value"],
  entry: ["graph", "index", "kind", "value"],
  module: ["graph", "index", "kind", "value"],
  edge: ["direction", "graph", "index", "kind", "module", "target"],
  moduleEnd: ["graph", "importedModules", "importers", "kind", "module"],
  end: ["kind"],
};
function* readRows(file: string, manifest: GraphManifest): Generator<Wire, void, unknown> {
  const descriptor = fs.openSync(file, "r"),
    buffer = Buffer.alloc(CHUNK_BYTES),
    hash = createHash("sha256");
  let parts: Buffer[] = [],
    bytes = 0,
    rows = 0;
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const data = buffer.subarray(0, count);
      hash.update(data);
      bytes += count;
      let start = 0;
      for (;;) {
        const end = data.indexOf(10, start);
        if (end === -1) break;
        parts.push(data.subarray(start, end));
        const line = Buffer.concat(parts).toString("utf8");
        parts = [];
        rows++;
        const value = JSON.parse(line) as Wire;
        assert.deepEqual(
          Object.keys(value).sort(),
          wireKeys[value.kind],
          "exact graph record fields",
        );
        yield value;
        start = end + 1;
      }
      if (start < count) parts.push(Buffer.from(data.subarray(start)));
    }
    assert.equal(parts.length, 0, "complete final newline required");
    assert.equal(bytes, manifest.bytes, "whole graph byte count");
    assert.equal(rows, manifest.rows, "whole graph record count");
    assert.equal(hash.digest("hex"), manifest.sha256, "whole graph content hash");
  } finally {
    fs.closeSync(descriptor);
  }
}
export type GraphVisitor = {
  entry?(graph: number, index: number, value: Entry): void;
  module?(graph: number, index: number, value: Scalars): void;
  edge?(graph: number, module: number, direction: Direction, index: number, target: number): void;
};

export function readNuxtUiGraphRecords(
  directory: string,
  manifest: GraphManifest,
  visit: GraphVisitor = {},
) {
  assert.equal(manifest.transport, "ordered-graph-records-v1");
  assert.equal(manifest.file, FILE, "owned graph file only");
  assert.equal(manifest.capture, path.basename(directory), "owned capture identity");
  assert.ok(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0);
  assert.ok(Number.isSafeInteger(manifest.rows) && manifest.rows > 0);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  const rows = readRows(path.join(directory, FILE), manifest);
  const next = () => {
    const row = rows.next();
    assert.equal(row.done, false, "complete ordered graph records required");
    return row.value;
  };
  const edgeTarget = (target: number, modules: number) =>
    assert.ok(
      Number.isInteger(target) && target >= 0 && target < modules,
      "complete module graph edge closure",
    );
  try {
    const header = next();
    assert.ok(header.kind === "header");
    const {
      transport: _transport,
      capture: _capture,
      file: _file,
      bytes: _bytes,
      rows: _rows,
      sha256: _hash,
      dimensions: _dimensions,
      ...identity
    } = manifest;
    assert.deepEqual(header.value, identity, "HTTP manifest binds exact graph process identity");
    const graphs: Dimensions[] = [];
    for (const [graph, expected] of manifest.dimensions.entries()) {
      const begin = next();
      assert.ok(begin.kind === "graph");
      assert.equal(begin.graph, graph);
      const total = dimensions(begin.value);
      for (let index = 0; index < expected.entries; index++) {
        const entry = next();
        assert.ok(entry.kind === "entry");
        assert.equal(entry.graph, graph);
        assert.equal(entry.index, index);
        edgeTarget(entry.value.module, expected.modules);
        assert.equal(typeof entry.value.id, "string");
        assert.deepEqual(Object.keys(entry.value).sort(), ["id", "module"]);
        total.entries++;
        measure(total, "entry.id", entry.value.id);
        visit.entry?.(graph, index, entry.value);
      }
      for (let index = 0; index < expected.modules; index++) {
        const module = next();
        assert.ok(module.kind === "module");
        assert.equal(module.graph, graph);
        assert.equal(module.index, index);
        assert.deepEqual(Object.keys(module.value).sort(), [...scalarFields].sort());
        assert.equal(typeof module.value.url, "string");
        for (const field of scalarFields) measure(total, `module.${field}`, module.value[field]);
        total.modules++;
        visit.module?.(graph, index, module.value);
        const counts = { importedModules: 0, importers: 0 };
        let importer = false;
        for (;;) {
          const edge = next();
          if (edge.kind === "moduleEnd") {
            assert.deepEqual(edge, { kind: "moduleEnd", graph, module: index, ...counts });
            break;
          }
          assert.ok(edge.kind === "edge");
          assert.equal(edge.graph, graph);
          assert.equal(edge.module, index);
          assert.ok(directions.includes(edge.direction));
          if (edge.direction === "importers") importer = true;
          else assert.equal(importer, false, "ordered imported edges precede importers");
          assert.equal(edge.index, counts[edge.direction]++);
          edgeTarget(edge.target, expected.modules);
          if (edge.direction === "importedModules") total.importedEdges++;
          else total.importerEdges++;
          visit.edge?.(graph, index, edge.direction, edge.index, edge.target);
        }
      }
      assert.deepEqual(total, expected, "whole graph dimensional parity");
      graphs.push(total);
    }
    assert.deepEqual(next(), { kind: "end" });
    assert.equal(rows.next().done, true, "no trailing graph records");
    return { ...header.value, graphs };
  } finally {
    rows.return(undefined);
  }
}
