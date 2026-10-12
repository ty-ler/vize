import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runNoMutatingCurrentCallerHistory } from "./support/no-mutating-props-current-caller-source-custody.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
void test("current complete23 refuses old tuples before the complete historical 7-case caller", async () => {
  await runNoMutatingCurrentCallerHistory(
    root,
    "tests/tooling/warm-type-backed-default-migration-host.test.ts",
  );
});
