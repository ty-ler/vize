import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const BOUND = 64 * 1024 * 1024;

/** Whole original raw input plus complete source-bound metadata share the original finite bound. */
export class NativeTraceCustody {
  readonly raw: string;
  readonly metadata: string;
  private rawBytes = 0;
  private metadataBytes = 0;
  private sequence = 0;
  private readonly rawDigest = createHash("sha256");
  private readonly metadataDigest = createHash("sha256");

  constructor(directory: string) {
    this.raw = path.join(directory, "native-api-kernel.raw");
    this.metadata = path.join(directory, "native-api-live-actors.jsonl");
    for (const file of [this.raw, this.metadata])
      fs.writeFileSync(file, "", { flag: "wx", mode: 0o600 });
  }

  input(chunk: Buffer) {
    assert.ok(
      this.rawBytes + this.metadataBytes + chunk.length <= BOUND,
      "whole raw trace and actor metadata exceed the original finite bound",
    );
    fs.appendFileSync(this.raw, chunk);
    this.rawBytes += chunk.length;
    this.rawDigest.update(chunk);
  }

  record(value: unknown) {
    const bytes = Buffer.from(
      `${JSON.stringify({
        sequence: this.sequence,
        observedMonotonicNs: String(process.hrtime.bigint()),
        value,
      })}\n`,
    );
    assert.ok(
      this.rawBytes + this.metadataBytes + bytes.length <= BOUND,
      "whole raw trace and actor metadata exceed the original finite bound",
    );
    fs.appendFileSync(this.metadata, bytes);
    this.metadataBytes += bytes.length;
    this.sequence++;
    this.metadataDigest.update(bytes);
  }

  snapshot() {
    return {
      raw: { file: this.raw, bytes: this.rawBytes, sha256: this.rawDigest.copy().digest("hex") },
      metadata: {
        file: this.metadata,
        bytes: this.metadataBytes,
        sha256: this.metadataDigest.copy().digest("hex"),
      },
      combinedRetainedBound: BOUND,
    };
  }
}
