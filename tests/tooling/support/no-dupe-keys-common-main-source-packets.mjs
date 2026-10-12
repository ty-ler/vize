import assert from "node:assert/strict";
import { joinObjectID, joinSHA } from "./no-mutating-component-join-physical.mjs";

export function validateCommonProcess(packet, cases) {
  assert.equal(packet.status, 0);
  assert.equal(packet.signal, null);
  assert.equal(packet.error, null);
  assert.equal(typeof packet.stdout, "string");
  assert.equal(typeof packet.stderr, "string");
  assert.equal(packet.stdoutSHA256, joinSHA(packet.stdout));
  assert.equal(packet.stderrSHA256, joinSHA(packet.stderr));
  for (const line of [
    "# tests " + cases,
    "# pass " + cases,
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ])
    assert(packet.stdout.split("\n").includes(line), packet.stdout);
  assert.equal(packet.sourceOnly, true);
  for (const name of ["compiled", "native", "performance"]) assert.equal(packet[name], false);
}
export function validateCommonNestedPacket(packet, declared) {
  if (declared.kind === "maintenance") return validateCommonMaintenancePacket(packet, declared);
  validateCommonProcess(packet, declared.cases);
  for (const [key, value] of Object.entries(declared.fields))
    assert.deepEqual(packet[key], value, key);
  for (const key of declared.nullFields) assert.equal(packet[key], null, key);
}
function rawBase64(value) {
  assert.equal(typeof value, "string");
  const body = Buffer.from(value, "base64");
  assert.equal(body.toString("base64"), value);
  return body;
}
export function validateCommonMaintenancePacket(packet, declared) {
  assert.equal(packet.sourceOnly, true);
  for (const name of ["native", "compiled", "performance", "exactFatalReproduced"])
    assert.equal(packet[name], false);
  assert.equal(packet.controlAssertionsPassed, true);
  assert.equal(packet.restoration, "verified");
  assert.equal(packet.traceStatus, "complete");
  assert.equal(packet.traceParseError, null);
  assert.deepEqual(packet.automaticActors, []);
  assert.equal(packet.runs.length, 15);
  assert.equal(packet.sources.length, 15);
  assert.match(packet.gitVersion, /^git version /u);
  const trace = rawBase64(packet.traceBase64);
  assert.equal(trace.length, packet.traceBytes);
  assert.equal(joinSHA(trace), packet.traceSHA256);
  const events = trace
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    events.filter((row) => row.event === "start" && row.argv?.includes("fetch")).length,
    15,
  );
  assert.deepEqual(
    events.filter(
      (row) =>
        row.event === "child_start" &&
        row.argv?.some((word) => ["maintenance", "repack", "gc"].includes(word)),
    ),
    [],
  );
  assert.equal(packet.sharedBefore.head, declared.modelSource + "\n");
  assert(
    Number.isSafeInteger(packet.sharedBefore.configBytes) && packet.sharedBefore.configBytes > 0,
  );
  assert.match(packet.sharedBefore.configSHA256, /^[a-f0-9]{64}$/u);
  assert.equal(packet.ownedBefore.length, 2);
  assert.equal(packet.ownedBeforeRestore.length, 2);
  for (const side of [packet.ownedBefore, packet.ownedBeforeRestore]) {
    assert.equal(rawBase64(side[0]).toString(), declared.parentFrameSource + "\n");
    if (side[1] !== null) rawBase64(side[1]);
  }
  if (packet.sharedBefore.shallowBase64 !== null) rawBase64(packet.sharedBefore.shallowBase64);
  for (const [index, source] of packet.sources.entries()) {
    const body = rawBase64(source.sourceBase64);
    const commit = rawBase64(source.commitBase64);
    assert.deepEqual(body, Buffer.from("whole private source " + index + "\n"));
    assert.equal(body.length, source.sourceBytes);
    assert.equal(joinSHA(body), source.sourceSHA256);
    assert.equal(joinObjectID("blob", body), source.blob);
    assert.equal(joinObjectID("commit", commit), source.source);
    assert.equal(commit.length, source.commitBytes);
    assert.equal(joinSHA(commit), source.commitSHA256);
    assert.equal(commit.subarray(0, commit.indexOf(10)).toString(), "tree " + source.tree);
    const parents = commit
      .toString()
      .split("\n")
      .filter((line) => line.startsWith("parent "));
    assert.deepEqual(parents, index ? ["parent " + packet.sources[index - 1].source] : []);
    const tree = Buffer.concat([
      Buffer.from("100644 source.txt\0"),
      Buffer.from(source.blob, "hex"),
    ]);
    assert.equal(joinObjectID("tree", tree), source.tree);
    const run = packet.runs[14 - index];
    assert.equal(run.source, source.source);
    assert.deepEqual(run.argv, [
      "--no-replace-objects",
      "fetch",
      "--no-tags",
      "--depth=1",
      "maintenance-control",
      source.source,
    ]);
    assert.equal(run.status, 0);
    assert.equal(run.signal, null);
    assert.equal(run.error, null);
    assert.equal(typeof run.stdout, "string");
    assert.equal(typeof run.stderr, "string");
  }
}
