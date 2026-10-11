import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { kernelDescriptor } from "./warm-type-backed-owner-syscalls.ts";

const MAX_LINE = 4 * 1024 * 1024 + 4096;
const MAX_SELECTED = 64 * 1024 * 1024;

/** Retain complete kernel-decorated pipe/socket writes; file writes grant no protocol authority. */
export class NativeProtocolStream {
  private line = "";
  private readonly pending = new Map<number, boolean>();
  private readonly digest = createHash("sha256");
  private selectedBytes = 0;
  private inputBytes = 0;
  private selectedWrites = 0;
  private fileWrites = 0;
  private wakeWrites = 0;
  private readonly retain: (line: string) => void;

  constructor(retain: (line: string) => void) {
    this.retain = retain;
  }

  push(chunk: Buffer) {
    this.digest.update(chunk);
    this.inputBytes += chunk.length;
    assert.ok(Number.isSafeInteger(this.inputBytes));
    const text = this.line + chunk.toString("ascii");
    let start = 0;
    let stop = text.indexOf("\n");
    while (stop >= 0) {
      const line = text.slice(start, stop);
      assert.ok(line.length <= MAX_LINE, "an oversized syscall line cannot qualify");
      this.accept(line);
      start = stop + 1;
      stop = text.indexOf("\n", start);
    }
    this.line = text.slice(start);
    assert.ok(this.line.length <= MAX_LINE, "an incomplete oversized syscall cannot qualify");
  }

  private accept(line: string) {
    if (!line) return;
    const prefix = line.match(/^(?:\[pid\s+(\d+)\]|(\d+))\s+\d+\.\d+\s+(.*)$/u);
    assert.ok(prefix, "each original syscall requires its kernel thread and timestamp");
    const thread = Number(prefix[1] ?? prefix[2]);
    const body = prefix[3];
    let selected: boolean;
    if (body.startsWith("<... write resumed>")) {
      assert.ok(this.pending.has(thread), "a resumed syscall requires its original descriptor");
      selected = this.pending.get(thread)!;
      this.pending.delete(thread);
    } else if (body.startsWith("write(")) {
      // The kernel descriptor ends before the quoted payload; TypeScript itself can contain `>, `.
      const encoded = body.match(/^write\(\d+<(.+?)>, "/u)?.[1];
      assert.ok(encoded, "undecorated or unknown writes cannot qualify");
      const descriptor = kernelDescriptor(encoded);
      if (/^pipe:\[\d+\]$/u.test(descriptor)) selected = true;
      else if (/^UNIX-STREAM:\[\d+(?:->\d+)?(?:,"[^"\n]+")?\]$/u.test(descriptor)) selected = true;
      else if (descriptor.startsWith("/")) {
        selected = false;
        this.fileWrites++;
      } else if (descriptor === "anon_inode:[eventfd]") {
        selected = false;
        this.wakeWrites++;
      } else throw new Error(`unknown syscall descriptor cannot qualify: ${descriptor}`);
      if (body.endsWith("<unfinished ...>")) {
        assert.equal(this.pending.has(thread), false, "unfinished syscalls must be unique");
        this.pending.set(thread, selected);
        assert.ok(this.pending.size <= 1024, "pending syscall metadata must remain bounded");
      }
      if (selected) this.selectedWrites++;
    } else {
      assert.ok(/^(---|\+\+\+)/u.test(body), "unknown syscall cannot qualify");
      selected = true;
    }
    if (!selected) return;
    const complete = `${line}\n`;
    this.selectedBytes += Buffer.byteLength(complete);
    assert.ok(
      this.selectedBytes <= MAX_SELECTED,
      "native protocol exceeds its finite transcript bound",
    );
    this.retain(complete);
  }

  /** Partial metadata grants no authority; retain the first failure without exposing payloads. */
  snapshot() {
    return {
      scope: "complete-kernel-decorated-pipe-and-Unix-stream-writes",
      inputBytes: this.inputBytes,
      inputSHA256: this.digest.copy().digest("hex"),
      selectedBytes: this.selectedBytes,
      selectedWrites: this.selectedWrites,
      excludedFileWrites: this.fileWrites,
      excludedEventfdWrites: this.wakeWrites,
      incompleteLineBytes: this.line.length,
      pendingWrites: this.pending.size,
      selectedTranscriptBound: MAX_SELECTED,
      singleLineBound: MAX_LINE,
    };
  }

  finish() {
    assert.equal(this.line, "", "a partial syscall line cannot qualify");
    assert.equal(this.pending.size, 0, "unfinished writes cannot grant authority");
    return this.snapshot();
  }
}
