import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const [repo, destination] = process.argv.slice(2);
const load = (relative) => import(pathToFileURL(path.join(repo, relative)).href);
const { LspSession } = await load("tests/tooling/support/lsp/session.ts");
const { withPinnedFixtureWorkspace } = await load("tests/_helpers/realworld-patch.ts");
const { manifest } = await load("tests/performance/support/current-baseline/inputs.ts");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const probes = {
  "__BorrowedProbe.vue":
    '<template><div/></template>\r\n<script setup lang="ts">\r\nconst borrowedProbe = 1;\r\nconst emit = defineEmits(["borrowed-event", "update:modelValue"]);\r\ndefineSlots<{ borrowedSlot(): unknown }>();\r\n</script>\r\n<style>.borrowed-class { color: red } #borrowed-id { color: blue }</style>\r\n<docs>Borrowed</docs>',
  "__UnicodeProbe.ts":
    "/* 🦀 */ export function café() {}\r\nexport const \\u0062orrowedEscaped = 1;\r\n",
  "__MalformedProbe.vue":
    "<template>one</template><template>two</template>\n<script setup>const counterfeitProbe = 1;</script>",
};
const queries = [
  "",
  "borrowed",
  "borrowedProbe",
  "BORROWED",
  "borrowed-event",
  "update:modelValue",
  "borrowedSlot",
  "borrowed-class",
  "borrowed-id",
  "café",
  "borrowedEscaped",
  "counterfeitProbe",
  "MkDivider",
  "ref",
  "save",
  "__absent_symbol__",
];
fs.mkdirSync(destination, { recursive: true });
await withPinnedFixtureWorkspace(
  { fixtureId: "misskey", includePaths: ["packages/frontend"] },
  async (fixture) => {
    const root = path.join(fixture.workspaceDir, "packages/frontend");
    const original = manifest(root);
    assert.deepEqual(original, manifest(path.join(fixture.upstreamDir, "packages/frontend")));
    for (const [name, text] of Object.entries(probes)) {
      fs.writeFileSync(path.join(root, "src", name), text, { flag: "wx" });
    }
    const selected = manifest(root);
    const session = new LspSession();
    let failure = null;
    const rows = [];
    try {
      await session.initialize(root, { editor: true, typecheck: false });
      for (const query of queries) {
        const result = await session.request("workspace/symbol", { query });
        rows.push({ query, result });
      }
      assert.equal(rows.find((row) => row.query === "counterfeitProbe").result, null);
      const unicode = rows.find((row) => row.query === "café").result;
      assert.deepEqual(unicode, [
        {
          name: "café",
          kind: 12,
          location: {
            uri: pathToFileURL(path.join(root, "src/__UnicodeProbe.ts")).href,
            range: { start: { line: 0, character: 25 }, end: { line: 0, character: 29 } },
          },
        },
      ]);
      for (const query of ["borrowedProbe", "borrowed-event", "borrowedSlot", "borrowedEscaped"]) {
        assert.ok(rows.find((row) => row.query === query).result?.length, query);
      }
    } catch (error) {
      failure = String(error);
    } finally {
      await session.shutdown();
      fs.writeFileSync(
        path.join(destination, "symbols.json"),
        JSON.stringify(
          {
            fixtureRevision: fixture.entry.revision,
            workspaceUri: pathToFileURL(root).href,
            selected,
            probes: Object.entries(probes).map(([name, text]) => ({
              name,
              text,
              sha256: digest(text),
            })),
            rows,
            failure,
            comparison:
              "Complete original JSON packets; only authenticated copied-workspace URI prefix can be translated between sessions",
          },
          null,
          2,
        ) + "\n",
      );
    }
    assert.equal(failure, null);
  },
);
