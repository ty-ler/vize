// Exercise the actual replay module graph under the shipping Node strip-only runtime.
import "../performance/support/warm-type-backed-owner-resolve.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { frameMessage } from "../differential/lsp-wire.ts";
import {
  nativeApiAttachments,
  syscallWrites,
  type NativeProcessWitness,
} from "../performance/support/warm-type-backed-owner-syscalls.ts";
import { NativeProtocolStream } from "../performance/support/warm-type-backed-owner-protocol-stream.ts";
import { sha256 } from "../performance/support/warm-type-backed-source.ts";

const request = {
  jsonrpc: "2.0",
  id: 1,
  method: "custom/initializeAPISession",
  params: { transport: "msgpack" },
};
const response = {
  jsonrpc: "2.0",
  id: 1,
  result: { pipe: "/tmp/tsgo-api-actual", sessionId: "api-session-1", transport: "msgpack" },
};
const parent: NativeProcessWitness = {
  pid: 10,
  ppid: 1,
  birthTicks: 123,
  executable: "/fixture/vize",
  executableSHA256: "a".repeat(64),
  threads: [10, 11],
  stdin: "pipe:[90]",
  stdout: "pipe:[91]",
  sockets: [],
};
const native: NativeProcessWitness = {
  pid: 20,
  ppid: 10,
  birthTicks: 456,
  executable: "/fixture/tsgo",
  executableSHA256: "b".repeat(64),
  threads: [20, 21],
  stdin: "pipe:[100]",
  stdout: "pipe:[101]",
  sockets: [{ pipe: "/tmp/tsgo-api-actual", inode: "202" }],
};
function write(thread: number, descriptor: string, bytes: Buffer) {
  const hex = [...bytes].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("");
  return `${thread} 1.000001 write(1<${descriptor}>, "${hex}", ${bytes.length}) = ${bytes.length}\n`;
}
const input = write(11, native.stdin, frameMessage(request));
const output = write(21, native.stdout, frameMessage(response));

await test("actual complete request/response bytes, process lineage and socket inode qualify together", () => {
  const [receipt] = nativeApiAttachments(input + output, [native], [parent]);
  assert.deepEqual(receipt.request, request);
  assert.deepEqual(receipt.response, response);
  assert.deepEqual(receipt.socket, native.sockets[0]);
  assert.equal(receipt.process.pid, 20);
});

await test("thread interleaving preserves every unfinished write byte and refuses incomplete resumes", () => {
  const line = write(21, native.stdout, frameMessage(response));
  const pending = line.replace(/\) = (\d+)\n$/u, " <unfinished ...>\n");
  const resumed = `21 1.000002 <... write resumed>) = ${frameMessage(response).length}\n`;
  assert.deepEqual(syscallWrites(pending + resumed)[0].bytes, frameMessage(response));
  assert.throws(() => syscallWrites(pending));
  assert.throws(() => syscallWrites(resumed));
});

await test("partial frames, truncated bytes and unknown syscalls cannot authenticate a session", () => {
  assert.throws(() =>
    nativeApiAttachments(input + output.replace(/ = \d+\n$/u, " = 2\n"), [native], [parent]),
  );
  assert.throws(() =>
    nativeApiAttachments(input + output.replace('"\\x43', '"...\\x43'), [native], [parent]),
  );
  assert.throws(() => syscallWrites("21 1.000001 read(1, 0, 0) = 0\n"));
});

await test("foreign writer, native process, returned pipe and duplicate original API response refuse", () => {
  assert.throws(() =>
    nativeApiAttachments(input.replace(/^11 /u, "99 ") + output, [native], [parent]),
  );
  assert.throws(() =>
    nativeApiAttachments(input + output.replace(/^21 /u, "99 "), [native], [parent]),
  );
  const foreign = { ...response, result: { ...response.result, pipe: "/tmp/tsgo-api-foreign" } };
  assert.throws(() =>
    nativeApiAttachments(
      input + write(21, native.stdout, frameMessage(foreign)),
      [native],
      [parent],
    ),
  );
  assert.throws(() => nativeApiAttachments(input + output + output, [native], [parent]));
});

await test("PID reuse, changed executable, shared pipe ownership and changed original client refuse", () => {
  assert.throws(() =>
    nativeApiAttachments(input + output, [native, { ...native, birthTicks: 999 }], [parent]),
  );
  assert.throws(() =>
    nativeApiAttachments(
      input + output,
      [native, { ...native, executableSHA256: "c".repeat(64) }],
      [parent],
    ),
  );
  assert.throws(() => nativeApiAttachments(input + output, [{ ...native, ppid: 30 }], [parent]));
  const shared = { ...native, pid: 30, birthTicks: 789, threads: [30], stdout: "pipe:[102]" };
  assert.throws(() =>
    nativeApiAttachments(
      input + output + write(30, shared.stdout, frameMessage(response)),
      [native, shared],
      [parent],
    ),
  );
  assert.throws(() =>
    nativeApiAttachments(input + output, [native], [parent, { ...parent, birthTicks: 999 }]),
  );
});

await test("Unix socket peer arrows preserve the complete decorated descriptor and bytes", () => {
  const descriptor = 'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]';
  const bytes = Buffer.from([0x93, 1, 0xc4, 0]);
  const [observed] = syscallWrites(write(21, descriptor, bytes));
  assert.equal(observed.descriptor, descriptor);
  assert.deepEqual(observed.bytes, bytes);
  assert.equal(
    nativeApiAttachments(input + write(21, descriptor, bytes) + output, [native], [parent]).length,
    1,
  );
});

function protocolStream(text: string) {
  let selected = "";
  const stream = new NativeProtocolStream((line) => (selected += line));
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += 7)
    stream.push(bytes.subarray(offset, offset + 7));
  return { selected, scope: stream.finish() };
}

await test("the bounded observer retains every protocol byte and hashes excluded filesystem writes", () => {
  const regular = write(11, "/fixture/virtuals/Comp0.vue.ts", Buffer.from("synthetic source"));
  const wake = write(21, "anon_inode:[eventfd]", Buffer.alloc(8));
  const trace = input + regular + wake + output;
  const { selected, scope } = protocolStream(trace);
  assert.equal(selected, input + output);
  assert.equal(scope.inputBytes, Buffer.byteLength(trace));
  assert.equal(scope.inputSHA256, sha256(Buffer.from(trace)));
  assert.equal(scope.selectedBytes, Buffer.byteLength(input + output));
  assert.equal(scope.selectedWrites, 2);
  assert.equal(scope.excludedFileWrites, 1);
  assert.equal(scope.excludedEventfdWrites, 1);
  assert.deepEqual(nativeApiAttachments(selected, [native], [parent])[0].response, response);
});

await test("unfinished filesystem and protocol writes retain independent exact thread custody", () => {
  const nativeLine = output.replace(/\) = (\d+)\n$/u, " <unfinished ...>\n");
  const fileLine = write(11, "/fixture/source.ts", Buffer.from("a")).replace(
    /\) = (\d+)\n$/u,
    " <unfinished ...>\n",
  );
  const nativeResume = `21 1.000002 <... write resumed>) = ${frameMessage(response).length}\n`;
  const fileResume = "11 1.000002 <... write resumed>) = 1\n";
  const { selected, scope } = protocolStream(
    input + fileLine + nativeLine + fileResume + nativeResume,
  );
  assert.equal(selected, input + nativeLine + nativeResume);
  assert.equal(scope.excludedFileWrites, 1);
  assert.deepEqual(nativeApiAttachments(selected, [native], [parent])[0].response, response);
  assert.throws(() => protocolStream(input + nativeLine));
  assert.throws(() => protocolStream(nativeResume));
});

await test("unknown descriptors, syscalls and partial lines never receive protocol authority", () => {
  for (const trace of [
    write(21, "TCP:[123]", Buffer.from("a")),
    write(21, "unknown", Buffer.from("a")),
    '21 1.000001 write(1, "\\x61", 1) = 1\n',
    "21 1.000001 read(1, 0, 0) = 0\n",
    output.slice(0, -1),
  ])
    assert.throws(() => protocolStream(trace));
  const { selected } = protocolStream(input + output.replace('"\\x43', '"...\\x43'));
  assert.throws(() => nativeApiAttachments(selected, [native], [parent]));
});

await test("partial failure metadata preserves custody without completing or consuming the trace", () => {
  let selected = "";
  const stream = new NativeProtocolStream((line) => (selected += line));
  const first = Buffer.from(input + output.slice(0, -1));
  stream.push(first);
  const partial = stream.snapshot();
  assert.equal(partial.inputSHA256, sha256(first));
  assert.equal(partial.incompleteLineBytes, output.length - 1);
  assert.equal(partial.selectedBytes, Buffer.byteLength(input));
  assert.throws(() => stream.finish(), /partial syscall line/);
  assert.deepEqual(stream.snapshot(), partial);
  stream.push(Buffer.from("\n"));
  const complete = stream.finish();
  assert.equal(complete.inputSHA256, sha256(Buffer.from(input + output)));
  assert.equal(complete.incompleteLineBytes, 0);
  assert.deepEqual(nativeApiAttachments(selected, [native], [parent])[0].response, response);
});

await test("the protocol transcript retains its original 64MiB ceiling and finite line bound", () => {
  const line = write(21, "pipe:[101]", Buffer.alloc(1024));
  const chunk = Buffer.from(line.repeat(250));
  const stream = new NativeProtocolStream(() => {});
  assert.throws(() => {
    for (let i = 0; i < 80; i++) stream.push(chunk);
  }, /finite transcript bound/);
  const oversized = new NativeProtocolStream(() => {});
  assert.throws(
    () => oversized.push(Buffer.alloc(4 * 1024 * 1024 + 4097, 97)),
    /oversized syscall/,
  );
});
