import assert from "node:assert/strict";
import { test } from "node:test";

import { frameMessage } from "../differential/lsp-wire.ts";
import { kernelStringBytes } from "../performance/support/warm-type-backed-owner-kernel-string.ts";
import {
  nativeApiAttachments,
  syscallWrites,
} from "../performance/support/warm-type-backed-owner-syscalls.ts";
import { nativeApiSocketTraffic } from "../performance/support/warm-type-backed-owner-socket-traffic.ts";
import { sha256 } from "../performance/support/warm-type-backed-source.ts";
import {
  native,
  parent,
  request,
  response,
  input,
  output,
  protocolStream,
} from "./support/warm-type-backed-owner-kernel-fixture.ts";

// Independent encoding of the actual v6.8 HEXSTR_NON_ASCII_CHARS contract.
function quoted(bytes: Buffer) {
  const symbols = new Map([
    [34, '\\"'],
    [92, "\\\\"],
    [12, "\\f"],
    [10, "\\n"],
    [13, "\\r"],
    [9, "\\t"],
    [11, "\\v"],
  ]);
  return [...bytes]
    .map(
      (byte) =>
        symbols.get(byte) ??
        (byte >= 32 && byte <= 126
          ? String.fromCharCode(byte)
          : `\\x${byte.toString(16).padStart(2, "0")}`),
    )
    .join("");
}

function write(thread: number, descriptor: string, bytes: Buffer) {
  return `${thread} 1.000001 write(1<${descriptor}>, "${quoted(bytes)}", ${bytes.length}) = ${bytes.length}\n`;
}

await test("all 256 kernel byte values and adjacent escapes decode without losing one byte", () => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
  const complete = Buffer.concat([bytes, Buffer.from('日本語 "quoted" \\x42\r\n\t0127'), bytes]);
  assert.deepEqual(kernelStringBytes(quoted(complete)), complete);
  assert.deepEqual(syscallWrites(write(21, native.stdout, complete))[0].bytes, complete);
  assert.equal(kernelStringBytes("\\x00123").toString("hex"), "00313233");
});

await test("compact kernel encoding retains complete API messages and original raw trace custody", () => {
  const compact =
    write(11, native.stdin, frameMessage(request)) +
    write(21, native.stdout, frameMessage(response));
  const { selected, scope } = protocolStream(compact);
  assert.equal(selected, compact);
  assert.equal(scope.inputSHA256, sha256(Buffer.from(compact)));
  assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(input + output));
  const [observed] = nativeApiAttachments(selected, [native], [parent]);
  const [hex] = nativeApiAttachments(input + output, [native], [parent]);
  assert.deepEqual(observed, hex);
  const original = {
    jsonrpc: "2.0",
    id: 9,
    method: "getSourceFile",
    params: {
      file: "/fixture/Comp0.vue.ts",
      source: '/** 日本語 \\ */\nconst name = "unchanged";',
    },
  };
  const answer = { jsonrpc: "2.0", id: 9, result: original.params };
  const api =
    write(11, "UNIX-STREAM:[203->202]", frameMessage(original)) +
    write(21, 'UNIX-STREAM:[202->203,"/tmp/tsgo-api-actual"]', frameMessage(answer));
  const traffic = nativeApiSocketTraffic(
    syscallWrites(protocolStream(api).selected),
    native,
    native.sockets[0],
    [parent],
  );
  assert.deepEqual(traffic.client, [original]);
  assert.deepEqual(traffic.server, [answer]);
  assert.equal(traffic.clientSHA256, sha256(frameMessage(original)));
  assert.equal(traffic.serverSHA256, sha256(frameMessage(answer)));
});

await test("unknown, incomplete, ambiguous and truncated kernel syntax cannot authenticate bytes", () => {
  for (const encoded of [
    "\\",
    "\\x",
    "\\x0",
    "\\xGG",
    "\\u0041",
    "\\077",
    "\\a",
    "\\b",
    '"',
    "日本語",
    "\n",
    "\0",
  ])
    assert.throws(() => kernelStringBytes(encoded));
  const complete = write(21, native.stdout, frameMessage(response));
  for (const line of [
    complete.replace('", ', '"..., '),
    complete.replace(/ = \d+\n$/u, " = 999999\n"),
    complete.replace(/, (\d+)\) /u, ", 999999) "),
    complete.replace("Content-Length", "Content-\\qLength"),
  ])
    assert.throws(() => syscallWrites(line));
  const partial = complete.replace(/ = \d+\n$/u, " = 1\n");
  assert.throws(() =>
    nativeApiAttachments(
      write(11, native.stdin, frameMessage(request)) + partial,
      [native],
      [parent],
    ),
  );
});
