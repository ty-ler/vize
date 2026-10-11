// Exercise the actual replay module graph under the shipping Node strip-only runtime.
import "../performance/support/warm-type-backed-owner-resolve.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { frameMessage } from "../differential/lsp-wire.ts";
import {
  nativeApiAttachments,
  syscallWrites,
} from "../performance/support/warm-type-backed-owner-syscalls.ts";
import { NativeProtocolStream } from "../performance/support/warm-type-backed-owner-protocol-stream.ts";
import { nativeApiSocketTraffic } from "../performance/support/warm-type-backed-owner-socket-traffic.ts";
import { sha256 } from "../performance/support/warm-type-backed-source.ts";
import {
  request,
  response,
  parent,
  native,
  write,
  input,
  output,
  protocolStream,
} from "./support/warm-type-backed-owner-kernel-fixture.ts";

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

await test("inherited strace stderr retains exact kernel PID prefixes without inventing an owner", () => {
  const stderr = (input + output).replace(/^(\d+) /gmu, "[pid $1] ");
  const { selected, scope } = protocolStream(stderr);
  assert.equal(selected, stderr);
  assert.equal(scope.inputSHA256, sha256(Buffer.from(stderr)));
  assert.deepEqual(nativeApiAttachments(selected, [native], [parent])[0].response, response);
  assert.throws(() => protocolStream(stderr.replace(/^\[pid \d+\] /gmu, "")));
});

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

await test("complete kernel -xx filesystem paths retain trace custody without granting API authority", () => {
  const path = "/home/runner/work/_temp/warm-before/node_modules/.vize/lsp.log";
  const escaped = [...Buffer.from(path)]
    .map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`)
    .join("");
  const regular = write(11, escaped, Buffer.from("synthetic log"));
  const trace = input + regular + output;
  const { selected, scope } = protocolStream(trace);
  assert.equal(selected, input + output);
  assert.equal(scope.inputSHA256, sha256(Buffer.from(trace)));
  assert.equal(scope.inputBytes, Buffer.byteLength(trace));
  assert.equal(scope.excludedFileWrites, 1);
  assert.deepEqual(nativeApiAttachments(selected, [native], [parent])[0].response, response);
});

await test("partial, relative, NUL and mixed escaped paths remain unknown kernel descriptors", () => {
  for (const descriptor of [
    "\\x66\\x6f\\x6f",
    "\\x2f\\x00",
    "\\x2f\\x6",
    "\\x2fraw",
    '"\\x2f\\x61"',
  ])
    assert.throws(() => protocolStream(write(11, descriptor, Buffer.from("a"))));
});

await test("fully hex-escaped kernel pipe descriptors retain original bytes and exact process witnesses", () => {
  const escaped = (text: string) =>
    [...Buffer.from(text)].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("");
  const trace =
    write(11, escaped(native.stdin), frameMessage(request)) +
    write(21, escaped(native.stdout), frameMessage(response));
  const { selected, scope } = protocolStream(trace);
  assert.equal(selected, trace);
  assert.equal(scope.inputSHA256, sha256(Buffer.from(trace)));
  assert.deepEqual(
    syscallWrites(selected).map((row) => row.descriptor),
    [native.stdin, native.stdout],
  );
  const [attachment] = nativeApiAttachments(selected, [native], [parent]);
  assert.deepEqual(attachment.request, request);
  assert.deepEqual(attachment.response, response);
  assert.equal(attachment.process.pid, native.pid);
});

await test("fully escaped Unix descriptors preserve actual peer arrows and returned API inode", () => {
  const descriptor = 'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]';
  const escaped = [...Buffer.from(descriptor)]
    .map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`)
    .join("");
  const bytes = frameMessage({
    jsonrpc: "2.0",
    id: 8,
    method: "api/test",
    params: { source: "entire" },
  });
  const trace = input + write(21, escaped, bytes) + output;
  const { selected } = protocolStream(trace);
  assert.equal(selected, trace);
  assert.equal(syscallWrites(selected)[1].descriptor, descriptor);
  assert.deepEqual(syscallWrites(selected)[1].bytes, bytes);
  assert.equal(nativeApiAttachments(selected, [native], [parent])[0].socket.inode, "202");
  assert.throws(() => protocolStream(write(21, "\\x2f\\xff", Buffer.from("a"))), /losslessly/);
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
  const rejected = Buffer.concat([
    Buffer.from("21 1.000001 read("),
    Buffer.from([0, 127, 128, 255]),
    Buffer.from(") = 0\n"),
  ]);
  const failed = new NativeProtocolStream(() => assert.fail("rejected bytes grant no authority"));
  failed.push(rejected.subarray(0, 18));
  assert.throws(() => failed.push(rejected.subarray(18)), /unknown syscall cannot qualify/);
  const failure = failed.snapshot();
  assert.equal(failure.inputBytes, rejected.length);
  assert.equal(failure.inputSHA256, sha256(rejected));
  assert.equal(failure.selectedBytes, 0);
  assert.deepEqual(failure.rejectedLine, {
    thread: 21,
    timestamp: "1.000001",
    bytes: rejected.length,
    sha256: sha256(rejected),
    rawBase64: rejected.toString("base64"),
  });
});

const projectRequest = {
  jsonrpc: "2.0",
  id: 2,
  method: "getDefaultProjectForFile",
  params: { snapshot: "snapshot-actual", file: "/fixture/Comp0.vue.ts" },
};
const projectResponse = {
  jsonrpc: "2.0",
  id: 2,
  result: {
    id: "project-actual",
    configFileName: "/fixture/tsconfig.json",
    compilerOptions: { strict: true },
    rootFiles: ["/fixture/Comp0.vue.ts"],
  },
};
const apiClient = write(11, "UNIX-STREAM:[203->202]", frameMessage(projectRequest));
const apiServer = write(
  21,
  'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]',
  frameMessage(projectResponse),
);

await test("complete native API project/config payloads retain both exact independently owned peers", () => {
  const traffic = nativeApiSocketTraffic(
    syscallWrites(apiClient + apiServer),
    native,
    native.sockets[0],
    [parent],
  );
  assert.deepEqual(traffic.client, [projectRequest]);
  assert.deepEqual(traffic.server, [projectResponse]);
  assert.equal(traffic.clientInode, "203");
  assert.equal(traffic.clientSHA256, sha256(frameMessage(projectRequest)));
  assert.equal(traffic.serverSHA256, sha256(frameMessage(projectResponse)));
  const split = frameMessage(projectResponse);
  const first = write(20, 'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]', split.subarray(0, 11));
  const last = write(21, 'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]', split.subarray(11));
  assert.deepEqual(
    nativeApiSocketTraffic(syscallWrites(first + apiClient + last), native, native.sockets[0], [
      parent,
    ]).server,
    [projectResponse],
  );
});

await test("foreign/shared API writers, different peers, absent directions and partial frames refuse", () => {
  for (const text of [
    apiClient.replace(/^11 /u, "99 ") + apiServer,
    apiClient + apiServer.replace(/^21 /u, "11 "),
    apiClient + apiServer.replace("202->203", "202->204"),
    apiClient + apiServer.replace("202->203", "202"),
    apiClient.replace("203->202", "202->202") + apiServer,
    apiClient,
    apiServer,
    apiClient +
      write(
        21,
        'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]',
        frameMessage(projectResponse).subarray(0, -1),
      ),
  ])
    assert.throws(() =>
      nativeApiSocketTraffic(syscallWrites(text), native, native.sockets[0], [parent]),
    );
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
