import { runNoDupeParentCurrentCallerAncestryLaw } from "./support/no-dupe-keys-ci-repair-source-custody.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await runNoDupeParentCurrentCallerAncestryLaw(root);
