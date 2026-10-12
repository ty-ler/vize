import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNoMutatingModuleLayoutHistoricalLaw } from "./support/no-mutating-props-module-layout-source-custody.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await runNoMutatingModuleLayoutHistoricalLaw(
  root,
  "tests/tooling/no-mutating-props-test-correction-source-custody.test.mjs",
);
