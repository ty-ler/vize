/** Reverse only the named, complete packed-config extension before old custody laws. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

interface Extension {
  schema: string;
  beforeSha256: string;
  afterSha256: string;
  hunks: { before: string; after: string }[];
}
const witness = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../_fixtures/differential/vite-native-image-identity/packed-config-extension.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Extension;
const digest = (source: string) => createHash("sha256").update(source).digest("hex");

export function withoutPackedConfigExtension(source: string): string {
  assert.equal(witness.schema, "vize.native-smoke-packed-config-extension.v1");
  assert.equal(
    digest(source),
    witness.afterSha256,
    "complete current workflow matches the named extension",
  );
  for (const hunk of witness.hunks) {
    assert.equal(
      source.split(hunk.after).length,
      2,
      "each whole extension hunk occurs exactly once",
    );
    source = source.replace(hunk.after, hunk.before);
  }
  assert.equal(
    digest(source),
    witness.beforeSha256,
    "the complete pre-extension workflow stays exact",
  );
  return source;
}
