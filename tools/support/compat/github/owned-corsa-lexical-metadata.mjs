import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lexicalSourcePaths,
  validateLexicalSourceBodies,
} from "./native-lexical-composition-custody.mjs";
import { ownedCorsaNativeGatesMainBaseline } from "./owned-corsa-current-baseline.mjs";
import { ownedCorsaReader } from "./owned-corsa-source-reader.mjs";
import { ownedCorsaSource } from "./owned-corsa-source-custody.mjs";
import {
  ownedCorsaLexicalPaths,
  projectOwnedCorsaLexicalCopied,
  verifyOwnedCorsaLexicalAdapter,
} from "./owned-corsa-lexical-source.mjs";
import { qualifyOwnedCorsaHost } from "../../../../tests/performance/support/warm-type-backed-owned-corsa-host.ts";
import { nativeLexicalCompositionBodyPairs } from "../../../../tests/performance/support/warm-type-backed-native-lexical-composition-host.ts";
import { nativeProxyManifest } from "../../../../tests/performance/support/warm-type-backed-native-proxy-host.ts";

export const ownedLexicalSourcePaths = (manifest, helpers) =>
  ownedCorsaLexicalPaths(lexicalSourcePaths(manifest, helpers));

/** Both producer metadata and its consumer use this same whole-source gate. Original copied bytes stay literal. */
export function validateOwnedLexicalSourceBodies(manifest, copied, context) {
  if (!copied.some(({ file }) => file === "vendor/corsa/Cargo.toml"))
    return validateLexicalSourceBodies(manifest, copied);
  const { root, head } = context;
  const baseline = ownedCorsaNativeGatesMainBaseline.revision;
  const reader = ownedCorsaReader(root, baseline, head);
  const production = execFileSync(
    "git",
    [
      "--no-replace-objects",
      "diff",
      "--name-only",
      baseline,
      head,
      "--",
      "crates",
      "davinci",
      "vendor",
      "npm",
      "Cargo.toml",
      "Cargo.lock",
      ".cargo",
      ".config",
      "rust-toolchain.toml",
    ],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  verifyOwnedCorsaLexicalAdapter(reader);
  const host = qualifyOwnedCorsaHost(root, baseline, head, production, new Set());
  assert(host.nativeTerminalHost && "ownedCorsaSource" in host.nativeTerminalHost);
  const originalPaths = lexicalSourcePaths(
    manifest,
    [
      "native-lexical-dollar.sh",
      "native-lexical-dollar-metadata.mjs",
      "native-lexical-dollar-receipt.mjs",
      "native-lexical-composition-custody.mjs",
    ].map((name) => "tools/support/compat/github/" + name),
  );
  const view = projectOwnedCorsaLexicalCopied({
    copied,
    originalPaths,
    baseline: ownedCorsaSource.baseline,
    production,
    alreadyQualified: new Set(nativeProxyManifest.files.map(([file]) => file)),
    reader,
    historicalPairs: nativeLexicalCompositionBodyPairs,
  });
  const original = validateLexicalSourceBodies(
    manifest,
    view.historicalCopied,
    view.historicalReader,
  );
  assert(original);
  return {
    ...original,
    ownedCorsa: view.receipt,
    ownedNativeTerminalHost: host.nativeTerminalHost,
    originalCopiedProducerPreserved: true,
    runtimeCredit: false,
    performanceCredit: false,
  };
}
