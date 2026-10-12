import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { reviewedHostPaths } from "../performance/support/warm-type-backed-reviewed-hosts.ts";
import { nativeOwnedImageManifest as sdk } from "../performance/support/warm-type-backed-native-owned-image-host.ts";
import { nativeTerminalManifest as original } from "../performance/support/warm-type-backed-native-terminal-host.ts";
import {
  nativeLexicalCompositionBodyPairs,
  nativeLexicalCompositionManifest as composition,
  qualifyNativeTerminalHost,
} from "../performance/support/warm-type-backed-native-lexical-composition-host.ts";
import {
  nativeProxyManifest,
  qualifyNativeProxyHost,
} from "../performance/support/warm-type-backed-native-proxy-host.ts";

type Side = "before" | "after";
const entries = new Map<string, { before: string | null; after: string }>();
const put = (file: string, before: string | null, after: string) => {
  const previous = entries.get(file);
  if (previous) assert.deepEqual(previous, { before, after }, file);
  entries.set(file, { before, after });
};
const lexical = JSON.parse(
  fs.readFileSync(
    new URL(
      "../performance/support/warm-type-backed-lexical-dollar-manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  files: Array<[string, string | null, string]>;
  corpusBodies: Array<[string, string | null, string]>;
  preservedBodies: Array<[string, string]>;
};
for (const [file, before, after] of [
  ...nativeLexicalCompositionBodyPairs,
  ...sdk.corpusBodies,
  ...composition.historicalReplayBodies,
  ...nativeProxyManifest.files,
])
  put(file, before, after);
for (const [file, , accepted] of [...lexical.files, ...lexical.corpusBodies])
  put(
    file,
    accepted,
    composition.sourceSuccessors.find(([name]) => name === file)?.[3] ?? accepted,
  );
for (const [file, body] of lexical.preservedBodies)
  put(
    file,
    body,
    composition.incomingPreservedSuccessors.find(([name]) => name === file)?.[2] ?? body,
  );
const harness = original.qualifiedHarnessBodies.map(
  ([file, before, after]) =>
    [
      file,
      before,
      composition.qualifiedHarnessSuccessors.find(([name]) => name === file)?.[2] ??
        sdk.qualifiedHarnessBodies.find(([name]) => name === file)?.[2] ??
        after,
    ] as const,
);
for (const [file, before, after] of harness) put(file, before, after);
for (const [file, body] of original.preservedBodies)
  put(file, body, harness.find(([name]) => name === file)?.[2] ?? body);
const digest = (side: Side, file: string) => entries.get(file)?.[side] ?? null;
const sha256 = (body: Buffer | string) => createHash("sha256").update(body).digest("hex");
const actual = (side: Side, file: string) =>
  side === "before"
    ? digest(side, file)
    : sha256(fs.readFileSync(new URL("../../" + file, import.meta.url)));
const sdkFiles = nativeLexicalCompositionBodyPairs.map(([file]) => file);
const fixtureFiles = nativeProxyManifest.files.map(([file]) => file);
const production = [...sdkFiles, ...fixtureFiles];
const allowed = new Set(reviewedHostPaths);

test("all seven complete actual fixture bodies qualify without changing native source authority", () => {
  assert.equal(qualifyNativeTerminalHost(production, allowed, actual), null);
  const fixture = qualifyNativeProxyHost(production, allowed, actual);
  assert.ok(fixture);
  assert.deepEqual(fixture.files, fixtureFiles.toSorted());
  assert.equal(fixture.wholeFixtureBodyPairs, 7);
  assert.equal(fixture.runtimeCredit, false);
  assert.equal(fixture.performanceCredit, false);
  const qualified = new Set([...allowed, ...fixture.files]);
  const native = qualifyNativeTerminalHost(production, qualified, actual);
  assert.ok(native);
  assert.equal(native.completeBodyPairs, 121);
  assert.equal(native.wholeSourceBodyPairs, 122);
  assert.equal(native.preservedBodyPairs, 23);
  assert.equal(native.qualifiedHarnessBodyPairs, 2);
});

test("every absent or foreign whole fixture body refuses on either side", () => {
  for (const [file] of nativeProxyManifest.files)
    for (const side of ["before", "after"] as const)
      for (const bad of [null, "f".repeat(64)]) {
        if (bad === digest(side, file)) continue;
        assert.equal(
          qualifyNativeProxyHost(production, allowed, (s, f) =>
            s === side && f === file ? bad : digest(s, f),
          ),
          null,
          `${side}:${file}`,
        );
      }
});

test("missing duplicate unknown and fixture-absent production sets refuse", () => {
  for (const file of fixtureFiles)
    assert.equal(
      qualifyNativeProxyHost(
        production.filter((f) => f !== file),
        allowed,
        digest,
      ),
      null,
    );
  for (const file of fixtureFiles)
    assert.equal(qualifyNativeProxyHost([...production, file], allowed, digest), null);
  assert.equal(
    qualifyNativeProxyHost([...production, "crates/vize_maestro/src/foreign.rs"], allowed, digest),
    null,
  );
  assert.equal(qualifyNativeProxyHost(sdkFiles, allowed, digest), null);
  assert.equal(qualifyNativeProxyHost([], allowed, digest), null);
});

test("fixture receipt cannot bless foreign SDK bodies or an incomplete original authority", () => {
  const fixture = qualifyNativeProxyHost(production, allowed, actual);
  assert.ok(fixture);
  const qualified = new Set([...allowed, ...fixture.files]);
  for (const file of sdkFiles)
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyNativeTerminalHost(production, qualified, (s, f) =>
          s === side && f === file ? "f".repeat(64) : actual(s, f),
        ),
        null,
        `${side}:${file}`,
      );
  assert.equal(qualifyNativeTerminalHost(fixtureFiles, qualified, actual), null);
});

test("removing only fixture qualification restores the whole original400 workflow", () => {
  const workflow = fs.readFileSync(
    new URL("../performance/support/warm-type-backed-workflow.ts", import.meta.url),
    "utf8",
  );
  const restored = workflow
    .replace(
      'import { qualifyNativeProxyHost } from "./warm-type-backed-native-proxy-host.ts";\n',
      "",
    )
    .replace(
      `  const nativeProxyHost = !cut
    ? qualifyNativeProxyHost(production, allowed, (side, file) =>
        gitBodyDigest(driverRoot, side === "before" ? baseline : head, file),
      )
    : null;
  for (const file of nativeProxyHost?.files ?? []) allowed.add(file);
`,
      "",
    )
    .replace("        nativeProxyHost,\n", "");
  assert.equal(sha256(restored), nativeProxyManifest.workflowBeforeSHA256);
  assert.notEqual(restored, workflow);
});
