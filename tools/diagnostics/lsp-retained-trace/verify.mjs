import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const output = process.argv[2];
const json = (file) => JSON.parse(fs.readFileSync(path.join(output, file), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const transform = (value, prefix) => {
  if (typeof value === "string")
    return value.startsWith(prefix)
      ? `__AUTHENTIC_WORKSPACE__${value.slice(prefix.length)}`
      : value;
  if (Array.isArray(value)) return value.map((item) => transform(item, prefix));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, transform(item, prefix)]),
    );
  return value;
};
function frames(file) {
  const wire = fs.readFileSync(file);
  const packets = [];
  let cursor = 0;
  while (cursor < wire.length) {
    const end = wire.indexOf("\r\n\r\n", cursor);
    assert(end >= cursor, "complete header is required");
    const header = wire.subarray(cursor, end).toString("ascii");
    const length = header.match(/^Content-Length: (\d+)(?:\r\n|$)/i);
    assert(length, "genuine Content-Length is required");
    const next = end + 4 + Number(length[1]);
    assert(next <= wire.length, "complete body is required");
    packets.push(JSON.parse(wire.subarray(end + 4, next).toString("utf8")));
    cursor = next;
  }
  return packets;
}
function session(directory, role) {
  const sessions = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.equal(sessions.length, 1, "exactly one original LSP session");
  const root = path.join(directory, sessions[0].name);
  const observation = JSON.parse(fs.readFileSync(path.join(root, "observation.json"), "utf8"));
  const receipt = json(`${role}.build-receipt.json`);
  assert.equal(observation.state, "process-closed");
  assert.equal(observation.sourceRevision, receipt.sourceRevision);
  assert.equal(observation.binary.binarySha256, receipt.binarySha256);
  assert.deepEqual(observation.process, { exitStatus: 0, signal: null, error: null });
  for (const stream of ["client", "server", "stderr"]) {
    const bytes = fs.readFileSync(path.join(root, `${stream}.bin`));
    const record = observation.streams[stream];
    assert.equal(record.truncated, false);
    assert.equal(record.observedBytes, bytes.length);
    assert.equal(record.capturedBytes, bytes.length);
    assert.equal(record.sha256, hash(bytes));
    if (stream !== "stderr") assert.equal(record.framing.state, "complete");
  }
  const client = frames(path.join(root, "client.bin"));
  const server = frames(path.join(root, "server.bin"));
  const init = client.find((packet) => packet.method === "initialize");
  assert(init?.params.rootUri);
  return { client, server, init };
}
function workspaceRows(directory, role) {
  const { client, server, init } = session(directory, role);
  const requests = client.filter((packet) => packet.method === "workspace/symbol");
  assert.equal(requests.length, 40, "the whole original lifecycle symbol workload is retained");
  const rows = requests.map((request) => {
    const responses = server.filter((packet) => packet.id === request.id);
    assert.equal(responses.length, 1, "each request has exactly one complete response");
    return { params: request.params, response: responses[0] };
  });
  return transform(rows, init.params.rootUri);
}
function diagnostics(directory, role) {
  const { server, init } = session(directory, role);
  const rows = server.filter((packet) => packet.method === "textDocument/publishDiagnostics");
  assert.equal(rows.length, 287);
  return transform(rows, init.params.rootUri);
}
const baseline = session(path.join(output, "1-before.custody"), "before");
const instrumented = session(path.join(output, "2-after.custody"), "after");
assert.deepEqual(
  workspaceRows(path.join(output, "1-before.custody"), "before"),
  workspaceRows(path.join(output, "2-after.custody"), "after"),
);
assert.deepEqual(
  diagnostics(path.join(output, "1-before.custody"), "before"),
  diagnostics(path.join(output, "2-after.custody"), "after"),
);
const receipts = [json("before.build-receipt.json"), json("after.build-receipt.json")];
assert.notEqual(
  receipts[0].binarySha256,
  receipts[1].binarySha256,
  "instrumentation must have a distinct real executable identity",
);
const memory = [];
for (const [label, role] of [
  ["1-before", "before"],
  ["2-after", "after"],
]) {
  const rows = fs
    .readFileSync(path.join(output, `${label}.rss.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const finish = rows.at(-1);
  assert.equal(finish.kind, "finish");
  assert.equal(finish.failure, null);
  const [pid, ticks] = finish.root;
  const samples = rows.filter((row) => row.kind === "sample");
  const parent = samples
    .flatMap((row) => row.members)
    .filter((row) => row.pid === pid && row.startTicks === ticks);
  assert(parent.length > 0);
  const clientSession = role === "before" ? baseline : instrumented;
  assert.equal(parent[0].parentPid, clientSession.init.params.processId);
  assert(
    parent.every((row) => row.executableSha256 === json(`${role}.build-receipt.json`).binarySha256),
  );
  const children = samples.flatMap((row) => row.members).filter((row) => row.pid !== pid);
  assert(children.length > 0);
  assert(children.every((row) => row.executableSha256 === json("backend.json").sha256));
  const maps = rows.filter((row) => row.kind === "maps");
  assert(
    maps.length > 0 &&
      maps.every((row) => row.root[0] === pid && row.root[1] === ticks && row.mappings.length > 0),
  );
  const peak = parent.reduce((a, b) => (a.smapsKiB.Rss > b.smapsKiB.Rss ? a : b));
  const last = parent.at(-1);
  memory.push({
    role,
    pid,
    birthTicks: ticks,
    initializationClientPid: clientSession.init.params.processId,
    elfSha256: peak.executableSha256,
    physicalPeakSmapsKiB: peak.smapsKiB,
    lastSmapsKiB: last.smapsKiB,
    observedMapsSnapshots: maps.length,
    passiveRootSamples: parent.length,
    maximumConcurrentProcesses: Math.max(...samples.map((row) => row.members.length)),
    maximumObserverScanMs: Math.max(...samples.map((row) => row.scanMs)),
  });
}
assert.equal(fs.readdirSync(path.join(output, "before.allocation")).length, 0);
const files = fs.readdirSync(path.join(output, "after.allocation"));
assert.equal(files.length, 1);
const trace = fs
  .readFileSync(path.join(output, "after.allocation", files[0]), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert(trace.length > 0 && trace.length <= 4096);
assert(
  trace.every(
    (row, index) =>
      row.sequence === index + 1 &&
      row.pid === memory[1].pid &&
      row.allocation_failures === 0 &&
      row.requested_bytes - row.released_bytes === row.approximate_net_bytes,
  ),
);
assert(
  trace.every(
    (row, index) =>
      index === 0 ||
      (row.requested_bytes >= trace[index - 1].requested_bytes &&
        row.released_bytes >= trace[index - 1].released_bytes &&
        BigInt(row.wall_ns) >= BigInt(trace[index - 1].wall_ns)),
  ),
);
const queries = [];
for (let ordinal = 1; ordinal <= 40; ordinal++) {
  const rows = trace.filter(
    (row) => row.scope === "workspace-query" && row.query_ordinal === ordinal,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].boundary, "begin");
  assert.equal(rows[1].boundary, "end");
  queries.push({
    ordinal,
    begin: rows[0],
    end: rows[1],
    requestedLayoutBytes: rows[1].requested_bytes - rows[0].requested_bytes,
    releasedLayoutBytes: rows[1].released_bytes - rows[0].released_bytes,
    approximateNetDelta: rows[1].approximate_net_bytes - rows[0].approximate_net_bytes,
    durationMs: Number(BigInt(rows[1].wall_ns) - BigInt(rows[0].wall_ns)) / 1e6,
  });
}
assert.equal(trace.filter((row) => row.scope === "workspace-query").length, 80);
const sources = [];
for (const uri of new Set(
  trace.filter((row) => row.scope === "source").map((row) => row.source_uri),
)) {
  assert.equal(typeof uri, "string");
  assert(uri.startsWith(instrumented.init.params.rootUri + "/"));
  const rows = trace.filter((row) => row.scope === "source" && row.source_uri === uri);
  assert.equal(rows[0].boundary, "begin");
  assert.equal(rows.at(-1).boundary, "end");
  assert(
    rows.length === 2 ||
      (rows.length === 3 && rows[1].boundary === "loaded" && rows[1].source_bytes >= 0),
  );
  sources.push({
    uri,
    bytes: rows.find((row) => row.boundary === "loaded")?.source_bytes ?? null,
    requestedLayoutBytes: rows.at(-1).requested_bytes - rows[0].requested_bytes,
    releasedLayoutBytes: rows.at(-1).released_bytes - rows[0].released_bytes,
    approximateNetDelta: rows.at(-1).approximate_net_bytes - rows[0].approximate_net_bytes,
    durationMs: Number(BigInt(rows.at(-1).wall_ns) - BigInt(rows[0].wall_ns)) / 1e6,
    begin: rows[0],
    end: rows.at(-1),
  });
}
assert(sources.length > 0);
const measured = json("measurements.json");
assert.equal(measured.results.length, 2);
assert(measured.results.every((row) => row.publishes === 287 && row.cycleStats.cycles === 40));
const report = {
  status: "diagnostic-completed",
  acceptanceCredit: 0,
  sourceHeads: receipts.map((row) => row.sourceRevision),
  completeRawClientPacketsCaptured: true,
  initializationClientPidsBoundToObservedNativeParent: true,
  wholeDiagnosticsPerSession: 287,
  wholeWorkspaceResponsesPerSession: 40,
  measured,
  memory,
  allocation: {
    records: trace.length,
    firstCollectorSources: sources.length,
    queries,
    highestRequestedSources: [...sources]
      .sort((a, b) => b.requestedLayoutBytes - a.requestedLayoutBytes)
      .slice(0, 20),
    highestNetGrowthSources: [...sources]
      .sort((a, b) => b.approximateNetDelta - a.approximateNetDelta)
      .slice(0, 20),
  },
  limits:
    "Unchanged original controls and budgets. Instrumented source is explicitly different and grants zero production acceptance. Global requested-layout net is approximate: pre-enable allocations/deallocations, concurrent actors, logger allocations, allocator padding/metadata, native C allocations and other processes prevent exact live heap attribution. Passive maps/RSS are sampled at distinct times. No reset, subtraction, suppression, trim, cache eviction or extra requests.",
};
fs.writeFileSync(path.join(output, "trace-summary.json"), JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    status: report.status,
    acceptanceCredit: 0,
    originalResults: measured.results,
    allocationRecords: trace.length,
    firstCollectorSources: sources.length,
    wholePacketEquality: true,
  }),
);
