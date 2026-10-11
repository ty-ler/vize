import { createHash } from "node:crypto";
import fs from "node:fs";
import { componentContextManifest as original } from "../../performance/support/warm-type-backed-component-context-manifest.ts";
import successor from "../../performance/support/warm-type-backed-component-owner-migration-manifest.json" with { type: "json" };
import loader from "../../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import nullCompletion from "../../performance/support/warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };
import { qualifyComponentOwnerMigrationHost } from "../../performance/support/warm-type-backed-component-owner-migration-host.ts";

type Pair = [string, string | null, string];

/** Test expectations are complete pinned preimages; actual AFTER always reads whole source bytes. */
export function componentOwnerSourcePair(composed: boolean) {
  const changed = new Map(successor.harnessSuccessors.map(([file, , after]) => [file, after]));
  const resolve = nullCompletion.harnessSuccessor[0];
  const production = new Map<string, Pair>();
  if (composed)
    for (const [file, before, , after] of original.inheritedProductionBodies)
      production.set(file, [file, before, after]);
  for (const [file, inherited, after, before] of original.componentBodies)
    production.set(file, [file, composed ? before : inherited, after]);
  const bodies = new Map(production);
  for (const [file, before, inherited, after] of original.inheritedProductionBodies)
    bodies.set(file, [file, composed ? before : inherited, after]);
  for (const [file, before, inherited] of original.inheritedCustodyBodies)
    bodies.set(file, [file, composed ? before : inherited, changed.get(file) ?? inherited]);
  for (const [file, absent, inherited] of original.inheritedHarnessExtensions)
    bodies.set(file, [
      file,
      composed ? absent : file === resolve ? changed.get(file)! : inherited,
      changed.get(file) ?? inherited,
    ]);
  for (const [file, before, after] of loader.composedContext)
    bodies.set(file!, [file!, before, after!]);
  for (const [file, after] of original.originalComponentBodies)
    bodies.set(file, [file, null, after]);
  const metadata =
    "tests/performance/support/warm-type-backed-project-config-null-completion-manifest.json";
  bodies.set(metadata, [metadata, null, successor.nullCompletionManifestBodySHA256]);
  const afterOnly = new Set([metadata, ...original.originalComponentBodies.map(([file]) => file)]);
  const digest = (side: "before" | "after", file: string) =>
    bodies.get(file)?.[side === "before" ? 1 : 2] ?? null;
  const actual = (side: "before" | "after", file: string) => {
    if (side === "before") return digest(side, file);
    try {
      return createHash("sha256")
        .update(fs.readFileSync(new URL("../../../" + file, import.meta.url)))
        .digest("hex");
    } catch {
      return null;
    }
  };
  return { production: [...production.keys()].toSorted(), bodies, afterOnly, digest, actual };
}

export function qualifyCurrentComponentOwnerSource(composed = true) {
  const pair = componentOwnerSourcePair(composed);
  return qualifyComponentOwnerMigrationHost(pair.production, new Set(), pair.actual);
}
