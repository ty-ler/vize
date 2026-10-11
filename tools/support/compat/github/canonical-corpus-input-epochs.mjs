import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseNativeVector } from "./canonical-corpus-native-walk.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const declaration = JSON.parse(
  readFileSync(new URL("./canonical-corpus-input-epochs.json", import.meta.url), "utf8"),
);
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const canonicalInputEpochs = freeze(declaration);

// These are finite source identities, not a count allowance for fixture growth.
export function canonicalInputEpoch(identity) {
  const epoch = declaration.epochs.find(
    (candidate) => candidate.gitlinksSha256 === identity?.gitlinksSha256,
  );
  assert(epoch, "Unqualified canonical corpus input epoch");
  assert.equal(identity.schema, "vize.canonical-corpus-identity");
  assert.equal(identity.version, 1);
  assert.equal(identity.repository, epoch.repository);
  assert.equal(identity.gitlinks.length, 148);
  assert.deepEqual(identity.gitlinks, epoch.gitlinks, "Foreign canonical epoch pins");
  assert.equal(hash(JSON.stringify(identity.gitlinks)), epoch.gitlinksSha256);
  for (const key of ["modulesSha256", "files", "filesSha256", "committedSha256"])
    assert.equal(identity[key], epoch[key], `Foreign canonical epoch ${key}`);
  for (const key of ["sourceSha256", "bodySha256", "vectorSha256", "boundarySha256"])
    assert.equal(identity.nativeWalk?.[key], epoch.nativeWalk[key], `Foreign native walk ${key}`);
  return epoch;
}

// Refuse an unknown identity before loading any vector or selected source bytes.
export function qualifyCanonicalInputs(identity, loadInputs) {
  const epoch = canonicalInputEpoch(identity);
  const { expected, vector } = loadInputs();
  assert(Array.isArray(expected), "Missing complete canonical epoch entries");
  assert.equal(expected.length, epoch.files, "Incomplete canonical epoch entries");
  assert.equal(hash(JSON.stringify(expected)), epoch.filesSha256, "Changed canonical epoch bytes");
  const paths = parseNativeVector(vector);
  if (epoch.name === "npmx-c9e8be91") assert.equal(paths.length, 44367);
  else assert.equal(paths.length, 44379);
  assert.equal(paths.filter((path) => path.startsWith("jellyfin-vue/")).length, 5576);
  assert.equal(hash(JSON.stringify(paths)), epoch.membershipSha256, "Changed source membership");
  assert.deepEqual(
    paths,
    expected.map(([path]) => path),
    "Changed canonical epoch order",
  );
  assert.equal(hash(vector), epoch.nativeWalk.vectorSha256, "Changed complete native vector");
  return { epoch, expected, vector };
}
