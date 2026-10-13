import path from "node:path";
import { importCanonProductRetainedModule } from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

await importCanonProductRetainedModule(
  path.resolve(import.meta.dirname, "../.."),
  "tests/tooling/native-lexical-dollar-receipt.test.mjs",
);
