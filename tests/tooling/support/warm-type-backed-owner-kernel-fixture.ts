import { frameMessage } from "../../differential/lsp-wire.ts";
import type { NativeProcessWitness } from "../../performance/support/warm-type-backed-owner-syscalls.ts";
import { NativeProtocolStream } from "../../performance/support/warm-type-backed-owner-protocol-stream.ts";

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

function protocolStream(text: string) {
  let selected = "";
  const stream = new NativeProtocolStream((line) => (selected += line));
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += 7)
    stream.push(bytes.subarray(offset, offset + 7));
  return { selected, scope: stream.finish() };
}

export { request, response, parent, native, write, input, output, protocolStream };
