import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
const manifest = JSON.parse(
  fs.readFileSync(new URL("./warm-type-backed-graph-manifest.json", import.meta.url), "utf8"),
) as { files: string[]; preservedBodies: string[] };
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "da67c0b266a29d54ee9561d7dc7dbe739e621cbc66e796ebeee2bdefbb009adc");
assert.equal(manifest.files.length, 195);
assert.equal(manifest.preservedBodies.length, 45);
const carrier =
  "crates/vize_canon/src/corsa_bridge/vue_dependencies_alias/context/build/consumption.rs";
const population =
  "crates/vize_canon/src/corsa_bridge/vue_dependencies_alias/context/build/consumption/population.rs";
const changed = [carrier, population].toSorted();
const parentCarrierSHA = "a54c5fa914714d8888ba2efef55e7c78c6a3205468677670374881e0239c66cc";

/** Admit exactly the optional two-path successor of the complete aaf producer. */
export function qualifyDiagnosticHost(production: string[], digest: BodyDigest) {
  if (new Set(production).size !== production.length) return null;
  if (JSON.stringify(production.toSorted()) !== JSON.stringify(changed)) return null;
  // The actual delta is two paths, but every preceding native producer body
  // must still agree on both sides. No omitted/unchanged producer is trusted.
  for (const row of manifest.files) {
    const [file, , after] = row.split("\t");
    const before = file === carrier ? parentCarrierSHA : file === population ? null : after;
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  }
  for (const row of manifest.preservedBodies) {
    const [file, body] = row.split("\t");
    if (digest("before", file) !== body || digest("after", file) !== body) return null;
  }
  return {
    authority: "complete-reviewed-optional-native-fact-diagnostic",
    originalSource: "aaf051206778b1f189dcc51386e992eb342ee8b0",
    reviewedSource: "6b665a1e93d59f35ced1be13c30168d86c919aeb",
    manifestSHA256,
    completeBodyPairs: 195,
    preservedBodyPairs: 45,
    files: changed,
  };
}
