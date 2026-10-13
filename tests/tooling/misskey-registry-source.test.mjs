import path from "node:path";
import { importCanonProductMisskeyModule } from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

await importCanonProductMisskeyModule(path.resolve(import.meta.dirname, "../.."));
