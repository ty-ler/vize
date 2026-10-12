import { runNoDupeExplainSnapshotHistoricalLaw } from "./support/no-dupe-keys-explain-snapshot-source-custody.mjs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
void test("private import example changes only its three whole explain snapshots", () => {
  runNoDupeExplainSnapshotHistoricalLaw(root);
});
