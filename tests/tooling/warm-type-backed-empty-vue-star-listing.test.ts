import path from "node:path";
import { importCanonProductParentListingModule } from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

await importCanonProductParentListingModule(
  path.resolve(import.meta.dirname, "../.."),
  "tests/tooling/warm-type-backed-empty-vue-star-listing.test.ts",
);
