import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sha256 } from "../differential/sha256.ts";
import { assessPacketCustody } from "../performance/support/allocation-diagnostic/packets.ts";

test("whole passive packet custody rejects missing chunks, reused birth, foreign providers and borrowed acceptance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-allocation-packet-law-"));
  const owner = {
    pid: 42,
    parentPid: 7,
    startTicks: "123",
    executableSha256: "a".repeat(64),
    executableDev: "1",
    executableIno: "2",
    executableSize: "3",
    executableMtimeNs: "4",
  };
  const launch = {
    binarySha256: owner.executableSha256,
    backendPath: "/owned/native",
    backendSha256: "b".repeat(64),
    acceptanceCredit: "none",
  };
  const close = {
    ns: "30",
    owner,
    providers: [
      {
        pid: 43,
        parentPid: 42,
        startTicks: "124",
        executable: launch.backendPath,
        executableSha256: launch.backendSha256,
        executableDev: "5",
        executableIno: "6",
        executableSize: "7",
        executableMtimeNs: "8",
      },
    ],
    acceptanceCredit: "none",
    streams: {} as Record<string, unknown>,
  };
  const chunks = [
    { ns: "10", stream: "client", start: 0, end: 2 },
    { ns: "20", stream: "server", start: 0, end: 1 },
    { ns: "25", stream: "stderr", start: 0, end: 1 },
  ];
  const writeChunks = (rows: unknown[]) =>
    fs.writeFileSync(
      path.join(root, "chunks.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  try {
    fs.writeFileSync(path.join(root, "process-start.json"), JSON.stringify({ ns: "1", owner }));
    for (const [name, text] of [
      ["client", "ab"],
      ["server", "c"],
      ["stderr", "d"],
    ]) {
      const bytes = Buffer.from(text);
      fs.writeFileSync(path.join(root, `${name}.bin`), bytes);
      close.streams[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
    writeChunks(chunks);
    assessPacketCustody(root, launch, close);
    for (const changed of [
      chunks.slice(1),
      chunks.toReversed(),
      chunks.map((row, i) => (i === 0 ? { ...row, start: 1 } : row)),
      chunks.map((row, i) => (i === 1 ? { ...row, end: 2 } : row)),
      chunks.map((row, i) => (i === 1 ? { ...row, ns: "31" } : row)),
      chunks.map((row, i) => (i === 0 ? { ...row, ns: "0" } : row)),
    ]) {
      writeChunks(changed);
      assert.throws(() => assessPacketCustody(root, launch, close));
    }
    writeChunks(chunks);
    for (const changed of [
      { ...close, owner: { ...owner, startTicks: "125" } },
      { ...close, acceptanceCredit: "full" },
      { ...close, providers: [] },
      { ...close, providers: [{ ...close.providers[0], parentPid: 999 }] },
      { ...close, providers: [{ ...close.providers[0], parentPid: close.providers[0].pid }] },
      { ...close, providers: [{ ...close.providers[0], executableIno: undefined }] },
      { ...close, providers: [{ ...close.providers[0], executable: "/foreign/native" }] },
      { ...close, providers: [{ ...close.providers[0], executableSha256: "c".repeat(64) }] },
    ])
      assert.throws(() => assessPacketCustody(root, launch, changed));
    fs.writeFileSync(path.join(root, "server.bin"), "changed complete stream");
    assert.throws(() => assessPacketCustody(root, launch, close));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
