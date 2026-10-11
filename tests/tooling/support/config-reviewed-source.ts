import { qualifyOwnedCompletionHost } from "../../performance/support/warm-type-backed-owned-completion-host.ts";
import { configReviewManifest } from "../../performance/support/warm-type-backed-config-review-host.ts";
import {
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../../performance/support/warm-type-backed-issued-completion-host.ts";

import { qualifyConfigRepairedReviewHost } from "../../performance/support/warm-type-backed-config-repair-host.ts";
import { canonBatchManifest } from "../../performance/support/warm-type-backed-config-canon-batch-host.ts";
import { runtimeRepairManifest } from "../../performance/support/warm-type-backed-project-config-runtime-repair.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
const bodies = new Map(
  [...configReviewManifest.productionBodies, ...configReviewManifest.harnessBodies].map((row) => [
    row[0],
    row,
  ]),
);
const batchBefore = new Map([
  ...canonBatchManifest.productionBodies.map(([file, before]) => [file, before] as const),
  ...canonBatchManifest.corpusBodies.map(([file, before]) => [file, before] as const),
]);
export const reviewedConfigProduction = [
  ...new Set([...issuedCompletionProduction, ...configReviewManifest.reviewedProductionFiles]),
].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export const canonBatchConfigProduction = [
  ...new Set([...reviewedConfigProduction, ...canonBatchManifest.newProductionFiles]),
].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Current files remain actual reads; only the explicitly frozen before fixture is extended. */
export function qualifyCurrentConfigReviewHost(allowed: ReadonlySet<string>, digest: Digest) {
  return qualifyOwnedCompletionHost(
    canonBatchConfigProduction,
    allowed,
    digest,
    (_files, _owned, authenticated) => {
      const runtimeBefore = new Map(
        runtimeRepairManifest.inheritedBodies.map(([file, , after]) => [file, after]),
      );
      const runtimeRepaired = [...runtimeBefore].every(
        ([file, after]) => authenticated("after", file) === after,
      );
      return qualifyConfigRepairedReviewHost(
        canonBatchConfigProduction,
        allowed,
        (side, file) =>
          side === "before" && runtimeRepaired && runtimeBefore.has(file)
            ? runtimeBefore.get(file)!
            : side === "before" && batchBefore.has(file)
              ? batchBefore.get(file)!
              : side === "before" && bodies.has(file)
                ? bodies.get(file)![1]
                : authenticated(side, file),
        qualifyIssuedCompletionHost,
      );
    },
  );
}
