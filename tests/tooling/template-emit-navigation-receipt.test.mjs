import path from "node:path";
import { importCanonProductTemplateEmitModule } from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

await importCanonProductTemplateEmitModule(path.resolve(import.meta.dirname, "../.."));
