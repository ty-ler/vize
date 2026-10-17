import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

test("rich host custody preserves the whole completion API result before Markdown assertions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-rich-custody-"));
  try {
    const source = fs.readFileSync(
      new URL("../../editors/vscode/test/suite/real-rich-hover-custody.cjs", import.meta.url),
      "utf8",
    );
    const module = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
    const require = createRequire(import.meta.url);
    vm.runInNewContext(source, {
      module,
      process,
      require: (name: string) =>
        name === "./real-server-support.cjs"
          ? { getWorkspaceFolderPath: () => root }
          : require(name),
    });
    const authored = "<template>{{ invoice. }}</template>";
    const request = module.exports.beginCompletion(
      {
        getText: () => authored,
        uri: { toString: () => "file:///project/App.vue" },
        version: 7,
        languageId: "vue",
      },
      { line: 0, character: 23 },
      { expression: "invoice.total", label: "total" },
      16,
    );
    const actual = {
      isIncomplete: false,
      items: [
        { label: "total", detail: "total: number", data: { original: [1, "opaque"] } },
        { label: "formatTotal", documentation: { value: "**JPY**", isTrusted: false } },
      ],
    };
    module.exports.retainCompletion(request, actual);
    const result = JSON.parse(
      fs.readFileSync(path.join(root, "node_modules/.vize/rich-hover.json"), "utf8"),
    );
    assert.equal(result.packets.length, 1);
    const packet = result.packets[0];
    assert.deepEqual(packet.actual, actual);
    assert.equal(packet.source, authored);
    assert.equal(packet.sourceSha256, createHash("sha256").update(authored).digest("hex"));
    assert.deepEqual(packet.document, {
      uri: "file:///project/App.vue",
      version: 7,
      languageId: "vue",
    });
    assert.deepEqual(packet.request, {
      method: "vscode.executeCompletionItemProvider",
      position: { line: 0, character: 23 },
      itemResolveCount: 16,
    });
    assert.deepEqual(packet.publicDocumentation, [
      { label: "total" },
      { label: "formatTotal", raw: actual.items[1].documentation, constructor: "Object" },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
