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
const before = json("before.symbols/symbols.json");
const after = json("after.symbols/symbols.json");
assert.equal(before.failure, null);
assert.equal(after.failure, null);
assert.equal(before.rows.length, 16, "the complete original independent query set is required");
assert.equal(after.rows.length, 16, "the complete original independent query set is required");
assert.deepEqual(before.selected, after.selected);
assert.deepEqual(before.probes, after.probes);
assert.equal(before.fixtureRevision, after.fixtureRevision);
assert.match(before.workspaceUri, /^file:\/\//);
assert.match(after.workspaceUri, /^file:\/\//);
assert.deepEqual(
  transform(before.rows, before.workspaceUri),
  transform(after.rows, after.workspaceUri),
);
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
const original = workspaceRows(path.join(output, "1-before.custody"), "before");
const originalDiagnostics = diagnostics(path.join(output, "1-before.custody"), "before");
for (const label of ["2-after", "3-after", "4-before"]) {
  const role = label.endsWith("after") ? "after" : "before";
  assert.deepEqual(workspaceRows(path.join(output, `${label}.custody`), role), original);
  assert.deepEqual(diagnostics(path.join(output, `${label}.custody`), role), originalDiagnostics);
}
for (const [role, stored] of [
  ["before", before],
  ["after", after],
]) {
  const { client, server, init } = session(path.join(output, `${role}.symbols/custody`), role);
  assert.equal(init.params.rootUri, stored.workspaceUri);
  const requests = client.filter((packet) => packet.method === "workspace/symbol");
  assert.equal(requests.length, stored.rows.length);
  const actual = requests.map((request) => {
    const response = server.filter((packet) => packet.id === request.id);
    assert.equal(response.length, 1);
    assert.equal(response[0].error, undefined);
    return { query: request.params.query, result: response[0].result };
  });
  assert.deepEqual(actual, stored.rows);
}
for (const [label, role] of [
  ["1-before", "before"],
  ["2-after", "after"],
  ["3-after", "after"],
  ["4-before", "before"],
]) {
  const rows = fs
    .readFileSync(path.join(output, `${label}.rss.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rows.at(-1).kind, "finish");
  assert.equal(rows.at(-1).failure, null);
  const root = rows.at(-1).root;
  assert(root && root.length === 2);
  const actual = rows
    .filter((row) => row.kind === "sample")
    .flatMap((row) => row.members)
    .filter((member) => member.pid === root[0] && member.startTicks === root[1]);
  assert(actual.length > 0);
  assert(
    actual.every(
      (member) => member.executableSha256 === json(`${role}.build-receipt.json`).binarySha256,
    ),
  );
  const descendants = rows
    .filter((row) => row.kind === "sample")
    .flatMap((row) => row.members)
    .filter((member) => member.pid !== root[0]);
  assert(descendants.length > 0);
  assert(descendants.every((member) => member.executableSha256 === json("backend.json").sha256));
}
const measured = json("measurements.json");
assert.equal(measured.results.length, 4);
assert.ok(
  measured.results.every((result) => result.publishes === 287 && result.cycleStats.cycles === 40),
);
fs.writeFileSync(
  path.join(output, "equivalence.json"),
  JSON.stringify(
    {
      status: "passed",
      wholeIndependentSymbolQueries: before.rows.length,
      wholeOriginalLifecycleResponsesPerSession: 40,
      wholeDiagnosticPacketsPerSession: 287,
      sessions: 4,
      rules:
        "Only the independently authenticated copied fixture workspace URI prefix is translated. All fields, request IDs, source inputs, ranges, order and values remain compared. Original 287 publishes and 40 cycles remain mandatory.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
