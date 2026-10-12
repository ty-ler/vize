import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runNoDupeCommonJoinSourceLaw } from "./support/no-dupe-keys-common-main-source-custody.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
void test("complete current source retains every whole original source law", async () => {
  await runNoDupeCommonJoinSourceLaw(
    root,
    "tests/tooling/no-mutating-component-join-source.test.mjs",
  );
});
