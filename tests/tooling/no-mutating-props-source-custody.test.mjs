import { runNoDupeParentHistoricalLaw } from "./support/no-dupe-keys-ci-repair-source-custody.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await runNoDupeParentHistoricalLaw(root, "tests/tooling/no-mutating-props-source-custody.test.mjs");
