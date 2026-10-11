import {
  configReviewManifest,
  qualifyConfigReviewHost,
} from "../../performance/support/warm-type-backed-config-review-host.ts";
import {
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../../performance/support/warm-type-backed-issued-completion-host.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
const bodies = new Map(
  [...configReviewManifest.productionBodies, ...configReviewManifest.harnessBodies].map((row) => [
    row[0],
    row,
  ]),
);
export const reviewedConfigProduction = [
  ...new Set([...issuedCompletionProduction, ...configReviewManifest.reviewedProductionFiles]),
].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Current files remain actual reads; only the explicitly frozen before fixture is extended. */
export function qualifyCurrentConfigReviewHost(allowed: ReadonlySet<string>, digest: Digest) {
  return qualifyConfigReviewHost(
    reviewedConfigProduction,
    allowed,
    (side, file) =>
      side === "before" && bodies.has(file) ? bodies.get(file)![1] : digest(side, file),
    qualifyIssuedCompletionHost,
  );
}
