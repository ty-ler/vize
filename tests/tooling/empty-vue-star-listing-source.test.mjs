import path from "node:path";
import { importCanonProductParentListingModule } from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

await importCanonProductParentListingModule(path.resolve(import.meta.dirname, "../.."), "tests/tooling/empty-vue-star-listing-source.test.mjs");
