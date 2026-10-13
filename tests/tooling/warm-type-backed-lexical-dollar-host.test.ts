import path from "node:path";
import { importCanonProductRetainedModule } from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

await importCanonProductRetainedModule(
  path.resolve(import.meta.dirname, "../.."),
  "tests/tooling/warm-type-backed-lexical-dollar-host.test.ts",
);
