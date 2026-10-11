import assert from "node:assert/strict";
import fs from "node:fs";

import { decodeFrames } from "../../differential/lsp-wire.ts";
import { object } from "./warm-type-backed-packets.ts";
import { sha256 } from "./warm-type-backed-source.ts";
import { kernelStringBytes } from "./warm-type-backed-owner-kernel-string.ts";

export type NativeProcessWitness = {
  pid: number;
  ppid: number;
  birthTicks: number;
  executable: string;
  executableSHA256: string;
  threads: number[];
  stdin: string;
  stdout: string;
  sockets: Array<{ pipe: string; inode: string }>;
};

type Write = { thread: number; descriptor: string; bytes: Buffer; line: string };

/** Losslessly decode -xx kernel descriptor syntax; raw trace lines remain unchanged. */
export function kernelDescriptor(encoded: string) {
  if (!encoded.startsWith("\\x")) return encoded;
  assert.match(encoded, /^(?:\\x[0-9a-f]{2})+$/u, "partial descriptor escapes cannot qualify");
  const bytes = Buffer.from(encoded.replaceAll("\\x", ""), "hex");
  assert.equal(bytes.includes(0), false, "NUL descriptors cannot qualify");
  const decoded = bytes.toString("utf8");
  assert.ok(Buffer.from(decoded).equals(bytes), "kernel descriptor bytes must decode losslessly");
  return decoded;
}

/** Decode complete successful writes only. Unknown or truncated relevant writes fail closed. */
export function syscallWrites(text: string): Write[] {
  const writes: Write[] = [];
  const pending = new Map<number, string>();
  for (const line of text.split("\n").filter(Boolean)) {
    const prefix = line.match(/^(?:\[pid\s+(\d+)\]|(\d+))\s+\d+\.\d+\s+(.*)$/u);
    assert.ok(prefix, "each syscall requires its actual thread and timestamp");
    const thread = Number(prefix[1] ?? prefix[2]);
    let body = prefix[3];
    if (body.includes("<unfinished ...>")) {
      assert.equal(pending.has(thread), false);
      pending.set(thread, body.replace(/\s*<unfinished \.\.\.>$/u, ""));
      continue;
    }
    if (body.startsWith("<... write resumed>")) {
      const prior = pending.get(thread);
      assert.ok(prior, "a resumed write must retain its original bytes");
      body = prior + body.replace(/^<\.\.\. write resumed>/u, "");
      pending.delete(thread);
    }
    if (!body.startsWith("write(")) {
      assert.ok(/^(---|\+\+\+|strace:)/u.test(body), "unknown syscall cannot qualify");
      continue;
    }
    // Errors transmit no bytes; a successful partial write retains only its actual count.
    if (/\)\s+= -1\s+[A-Z]+/u.test(body)) continue;
    const match = body.match(/^write\(\d+(<.+>), "((?:\\.|[^"\\])*)", (\d+)\)\s+= (\d+)$/u);
    assert.ok(match, "truncated, undecorated or unknown writes cannot qualify");
    const bytes = kernelStringBytes(match[2]);
    const requested = Number(match[3]);
    const transmitted = Number(match[4]);
    assert.equal(bytes.length, requested, "every original write byte must be observed");
    assert.ok(Number.isSafeInteger(transmitted) && transmitted >= 0 && transmitted <= requested);
    writes.push({
      thread,
      descriptor: kernelDescriptor(match[1].slice(1, -1)),
      bytes: bytes.subarray(0, transmitted),
      line,
    });
  }
  assert.equal(pending.size, 0, "unfinished writes cannot grant authority");
  return writes;
}

/** Actual returned attachment, paired with the actual request on that process's stdin pipe. */
export function nativeApiAttachments(
  text: string,
  witnesses: NativeProcessWitness[],
  parents: NativeProcessWitness[],
) {
  const writes = syscallWrites(text);
  assert.ok(parents.length > 0);
  const parent = parents[0];
  const parentThreads = new Set(
    parents.flatMap((entry) => {
      assert.equal(entry.pid, parent.pid);
      assert.equal(entry.birthTicks, parent.birthTicks);
      assert.equal(entry.executable, parent.executable);
      assert.equal(entry.executableSHA256, parent.executableSHA256);
      return entry.threads;
    }),
  );
  const unique = new Map<number, NativeProcessWitness>();
  for (const witness of witnesses) {
    const previous = unique.get(witness.pid);
    if (previous) {
      assert.equal(previous.birthTicks, witness.birthTicks, "PID reuse cannot grant authority");
      assert.equal(previous.executable, witness.executable);
      assert.equal(previous.executableSHA256, witness.executableSHA256);
      assert.equal(previous.stdin, witness.stdin);
      assert.equal(previous.stdout, witness.stdout);
      previous.threads = [...new Set([...previous.threads, ...witness.threads])];
      for (const socket of witness.sockets)
        if (
          !previous.sockets.some(
            (entry) => entry.pipe === socket.pipe && entry.inode === socket.inode,
          )
        )
          previous.sockets.push(socket);
    } else unique.set(witness.pid, structuredClone(witness));
  }
  const attachments = [...unique.values()].map((witness) => {
    assert.match(witness.stdin, /^pipe:\[\d+\]$/u);
    assert.match(witness.stdout, /^pipe:\[\d+\]$/u);
    assert.ok(witness.threads.includes(witness.pid));
    assert.equal(witness.ppid, parent.pid);
    const stdout = writes.filter(
      (write) => witness.threads.includes(write.thread) && write.descriptor === witness.stdout,
    );
    const stdin = writes.filter(
      (write) => parentThreads.has(write.thread) && write.descriptor === witness.stdin,
    );
    assert.ok(stdout.length && stdin.length, "both actual pipe directions are required");
    const responses = decodeFrames(Buffer.concat(stdout.map((write) => write.bytes))).messages;
    const requests = decodeFrames(Buffer.concat(stdin.map((write) => write.bytes))).messages;
    const apiRequests = requests.filter(
      (request) => request.method === "custom/initializeAPISession",
    );
    assert.equal(apiRequests.length, 1, "the original one-shot attachment must be unique");
    const request = apiRequests[0];
    const response = responses.filter((message) => message.id === request.id && !message.method);
    assert.equal(response.length, 1, "exact original API response is required");
    assert.equal(response[0].error, undefined);
    const result = object(response[0].result);
    assert.equal(typeof result.pipe, "string");
    assert.match(result.pipe as string, /^\/tmp\/tsgo-api-[^/]+$/u);
    assert.equal(typeof result.sessionId, "string");
    assert.match(result.sessionId as string, /^api-session-[1-9]\d*$/u);
    const sockets = witness.sockets.filter((socket) => socket.pipe === result.pipe);
    assert.equal(sockets.length, 1, "returned pipe must belong to the exact real native process");
    return {
      authority: "observed-original-native-api-response-and-kernel-pipe-owner",
      process: witness,
      request,
      response: response[0],
      socket: sockets[0],
      completeNativeStdinSHA256: sha256(Buffer.concat(stdin.map((write) => write.bytes))),
      completeNativeStdoutSHA256: sha256(Buffer.concat(stdout.map((write) => write.bytes))),
      completeNativeStdin: requests,
      completeNativeStdout: responses,
    };
  });
  assert.equal(
    new Set(attachments.map((entry) => entry.socket.pipe)).size,
    attachments.length,
    "independent native processes cannot claim the same API pipe",
  );
  assert.equal(
    new Set(attachments.map((entry) => entry.socket.inode)).size,
    attachments.length,
    "independent native processes cannot claim the same API socket inode",
  );
  return attachments;
}

export function syscallTranscriptDigest(file: string) {
  return sha256(fs.readFileSync(file));
}
