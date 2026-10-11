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
