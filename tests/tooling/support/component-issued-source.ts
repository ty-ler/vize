import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  componentOwnerSourcePair,
  qualifyCurrentComponentOwnerSource,
} from "./component-owner-migration-source.ts";
import { issuedCompletionManifest as issued } from "../../performance/support/warm-type-backed-issued-completion-host.ts";
import successor from "../../performance/support/warm-type-backed-component-issued-manifest.json" with { type: "json" };
import { qualifyComponentIssuedHost } from "../../performance/support/warm-type-backed-component-issued-host.ts";
import {
  configReviewManifest,
  qualifyConfigReviewHost,
} from "../../performance/support/warm-type-backed-config-review-host.ts";

/** Preserve every original pinned pair and add only the seven explicit complete producer bodies. */
export function componentIssuedSourcePair(composed: boolean) {
  const original = componentOwnerSourcePair(composed);
  const bodies = new Map(original.bodies);
  for (const [file, before, , after] of issued.producerBodies)
    bodies.set(file, [file, composed ? before : after, after!]);
  const production = composed
    ? [
        ...new Set([...original.production, ...issued.producerBodies.map(([file]) => file)]),
      ].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    : original.production;
  const metadata = "tests/performance/support/warm-type-backed-issued-completion-manifest.json";
  bodies.set(metadata, [metadata, null, successor.issuedManifestBodySHA256]);
  const afterOnly = new Set([...original.afterOnly, metadata]);
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
  return { production, bodies, afterOnly, digest, actual };
}

export function qualifyCurrentComponentIssuedSource(composed = true) {
  const pair = componentIssuedSourcePair(composed);
  const original = qualifyComponentIssuedHost(pair.production, new Set(), pair.actual);
  if (original) return original;
  const reviewed = new Map(
    [...configReviewManifest.productionBodies, ...configReviewManifest.harnessBodies].map((row) => [
      row[0],
      row,
    ]),
  );
  const production = composed
    ? [...new Set([...pair.production, ...configReviewManifest.reviewedProductionFiles])].toSorted()
    : pair.production;
  return qualifyConfigReviewHost(
    production,
    new Set(),
    (side, file) =>
      side === "before" && reviewed.has(file)
        ? reviewed.get(file)![composed ? 1 : 3]
        : pair.actual(side, file),
    qualifyComponentIssuedHost,
    composed ? "parent-pair" : "inherited",
  );
}

/** Historical authority is tried first; only the independently closed new footprint can follow it. */
export function qualifyCurrentComponentSuccessorSource(composed = true) {
  return (
    qualifyCurrentComponentOwnerSource(composed) ?? qualifyCurrentComponentIssuedSource(composed)
  );
}
