import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../../../differential/sha256.ts";

/** Whole chunk coverage and actual process-start/close custody stay separate from live metrics. */
export function assessPacketCustody(directory: string, launch: any, close: any): void {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  const start = read("process-start.json");
  assert.deepEqual(start.owner, close.owner);
  assert.equal(close.acceptanceCredit, "none");
  assert.equal(launch.acceptanceCredit, "none");
  assert(Number.isSafeInteger(close.owner.pid) && close.owner.pid > 0);
  assert(Number.isSafeInteger(close.owner.parentPid) && close.owner.parentPid > 0);
  assert.match(close.owner.startTicks, /^\d+$/);
  assert.equal(close.owner.executableSha256, launch.binarySha256);
  for (const key of ["executableDev", "executableIno", "executableSize", "executableMtimeNs"])
    assert.match(close.owner[key], /^\d+$/);
  assert(BigInt(start.ns) <= BigInt(close.ns));
  assert(close.providers.length > 0);
  for (const provider of close.providers) {
    assert.equal(provider.executable, launch.backendPath);
    assert.equal(provider.executableSha256, launch.backendSha256);
    assert(Number.isSafeInteger(provider.pid) && provider.pid > 0);
    assert.match(provider.startTicks, /^\d+$/);
  }
  const ends = { client: 0, server: 0, stderr: 0 };
  let previousNs = 0n;
  const chunks = fs.readFileSync(path.join(directory, "chunks.jsonl"), "utf8").trim().split("\n");
  assert(chunks.length > 0 && chunks[0] !== "");
  for (const raw of chunks) {
    const chunk = JSON.parse(raw) as {
      ns: string;
      stream: keyof typeof ends;
      start: number;
      end: number;
    };
    assert(Object.hasOwn(ends, chunk.stream));
    const ns = BigInt(chunk.ns);
    assert(ns >= previousNs && ns <= BigInt(close.ns));
    previousNs = ns;
    assert.equal(chunk.start, ends[chunk.stream]);
    assert(Number.isSafeInteger(chunk.end) && chunk.end > chunk.start);
    ends[chunk.stream] = chunk.end;
  }
  assert(Object.values(ends).reduce((a, b) => a + b, 0) <= 32 * 1024 * 1024);
  for (const [stream, length] of Object.entries(ends)) {
    const bytes = fs.readFileSync(path.join(directory, `${stream}.bin`));
    assert.equal(bytes.length, length);
    assert.equal(close.streams[stream].bytes, length);
    assert.equal(close.streams[stream].sha256, sha256(bytes));
  }
}
