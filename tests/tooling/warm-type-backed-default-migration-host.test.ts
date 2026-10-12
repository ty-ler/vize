import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runNoDupeParentCurrentCallerHistory } from "./support/no-dupe-keys-ci-repair-source-custody.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
void test("current complete23 refuses old tuples before the complete historical 7-case caller", async () => {
  await runNoDupeParentCurrentCallerHistory(
    root,
    "tests/tooling/warm-type-backed-default-migration-host.test.ts",
  );
});
