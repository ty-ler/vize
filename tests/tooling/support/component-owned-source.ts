import {
  componentOwnedManifest,
  qualifyComponentOwnedCompletionHost,
} from "../../performance/support/warm-type-backed-component-owned-completion-host.ts";
import { ownedCompletionManifest } from "../../performance/support/warm-type-backed-owned-completion-host.ts";
import { runtimeRepairManifest } from "../../performance/support/warm-type-backed-project-config-runtime-repair.ts";

type Digest = (side: "before" | "after", file: string) => string | null;

/** Extend only the explicitly declared BEFORE fixture; actual AFTER reads stay literal. */
export function componentOwnedSourceDigest(digest: Digest, composed: boolean): Digest {
  const rows = new Map(
    [...componentOwnedManifest.helperBodies, ...componentOwnedManifest.integrationBodies].map(
      (row) => [row[0], row],
    ),
  );
  const extensions = new Map(componentOwnedManifest.extensions.map((row) => [row[0], row]));
  const native = new Map(ownedCompletionManifest.extensions.map((row) => [row[0], row]));
  const tests = new Map(componentOwnedManifest.testBodies.map((row) => [row[0], row]));
  return (side, file) => {
    if (side === "after") return digest(side, file);
    if (rows.has(file)) return rows.get(file)![composed ? 1 : 2];
    if (extensions.has(file)) return null;
    if (native.has(file)) return composed ? null : native.get(file)![2];
    if (tests.has(file)) return tests.get(file)![composed ? 1 : 2];
    return digest(side, file);
  };
}

/** The preflight can run only after both helpers, workflow and all extensions close. */
export function componentRuntimePreflight(production: string[], digest: Digest, composed: boolean) {
  return qualifyComponentOwnedCompletionHost(
    production,
    new Set(),
    componentOwnedSourceDigest(digest, composed),
    (files, _owned, authenticated) =>
      runtimeRepairManifest.inheritedBodies.every(
        ([file, , after]) => authenticated("after", file) === after,
      )
        ? { files }
        : null,
    composed ? "parent-pair" : "inherited",
  );
}
