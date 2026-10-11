import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rejectOverrides } from "./installed.ts";

type Message = Record<string, unknown>;
export function message(value: unknown): Message {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Message;
}
/** One real installed process; retain every frame and decoded message, including unmatched publications. */
export class ComponentLsp {
  private child;
  private bytes = Buffer.alloc(0);
  private stdout: Buffer[] = [];
  private stderr: Buffer[] = [];
  private protocol: Array<{ direction: string; message: unknown }> = [];
  private incoming: Message[] = [];
  private publications: Message[] = [];
  private wake: (() => void) | undefined;
  private fault: unknown;
  private exit: { code: number | null; signal: string | null } | null = null;
  private closed: Promise<void>;
  private binary: string;
  constructor(binary: string, workspace: string) {
    this.binary = binary;
    rejectOverrides();
    this.child = spawn(binary, ["lsp"], { cwd: workspace, stdio: ["pipe", "pipe", "pipe"] });
    this.closed = new Promise((resolve) => {
      this.child.once("close", (code, signal) => {
        this.exit = { code, signal };
        this.wake?.();
        resolve();
      });
    });
    this.child.on("error", (error) => {
      this.fault = error;
      this.wake?.();
    });
    this.child.stdin.on("error", (error) => {
      this.fault = error;
      this.wake?.();
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr.push(chunk);
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdout.push(chunk);
      try {
        this.bytes = Buffer.concat([this.bytes, chunk]);
        assert.ok(this.bytes.length <= 8 * 1024 * 1024, "bounded complete LSP frame");
        for (;;) {
          const separator = this.bytes.indexOf("\r\n\r\n");
          if (separator < 0) break;
          const headers = this.bytes.subarray(0, separator).toString("ascii").split("\r\n");
          const lengths = headers.filter((header) => /^Content-Length:/iu.test(header));
          assert.equal(lengths.length, 1);
          const header = lengths[0].match(/^Content-Length: ([0-9]+)$/iu);
          assert.ok(header);
          const length = Number(header[1]);
          assert.ok(Number.isSafeInteger(length) && length > 0 && length <= 8 * 1024 * 1024);
          if (this.bytes.length < separator + 4 + length) break;
          const body = this.bytes.subarray(separator + 4, separator + 4 + length);
          const text = body.toString("utf8");
          assert.ok(Buffer.from(text).equals(body), "complete valid UTF-8 JSON frame");
          const packet = message(JSON.parse(text));
          this.protocol.push({ direction: "response", message: packet });
          this.incoming.push(packet);
          if (packet.method === "textDocument/publishDiagnostics") this.publications.push(packet);
          this.bytes = this.bytes.subarray(separator + 4 + length);
          this.wake?.();
        }
      } catch (error) {
        this.fault = error;
        this.wake?.();
      }
    });
  }
  send(packet: Message) {
    rejectOverrides();
    assert.equal(this.exit, null);
    const bytes = Buffer.from(JSON.stringify(packet));
    this.protocol.push({ direction: "request", message: packet });
    this.child.stdin.write(
      Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]),
    );
  }
  async receive(predicate: (packet: Message) => boolean): Promise<Message> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (this.fault) throw this.fault;
      const index = this.incoming.findIndex(predicate);
      if (index >= 0) return this.incoming.splice(index, 1)[0];
      assert.equal(this.exit, null, "installed LSP exited before its complete response");
      assert.ok(Date.now() < deadline, "installed LSP response deadline exceeded");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.wake = undefined;
          resolve();
        }, deadline - Date.now());
        this.wake = () => {
          clearTimeout(timer);
          this.wake = undefined;
          resolve();
        };
      });
    }
  }
  async stop() {
    if (this.exit === null) this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.child.kill("SIGKILL");
            reject(new Error("installed LSP exit deadline exceeded"));
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.fault) throw this.fault;
    assert.equal(this.bytes.length, 0, "stdout ends on the complete final frame");
    assert.deepEqual(this.exit, { code: 0, signal: null });
  }
  async abort() {
    if (this.exit === null) this.child.kill("SIGKILL");
    await this.closed;
  }
  terminal() {
    const stdout = Buffer.concat(this.stdout),
      stderr = Buffer.concat(this.stderr);
    return {
      executable: this.binary,
      pid: this.child.pid,
      protocol: this.protocol,
      publishedDiagnostics: this.publications,
      stdoutBase64: stdout.toString("base64"),
      stderrBase64: stderr.toString("base64"),
      stderrUtf8: stderr.toString("utf8"),
      undecodedBytesBase64: this.bytes.toString("base64"),
      exit: this.exit,
      fault:
        this.fault instanceof Error
          ? (this.fault.stack ?? this.fault.message)
          : this.fault
            ? JSON.stringify(this.fault)
            : null,
    };
  }
}
