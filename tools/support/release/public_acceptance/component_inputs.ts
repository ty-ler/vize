import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const rule = "vue/require-component-registration";
export const componentCorpus =
  "tests/_fixtures/differential/lint/component-registration-context-8142/cases.json";
export const componentCorpusSHA256 =
  "a651fc56a03eb60dae18c45ecc7d28083e5b57d51b19d51dad8e8ecaad6f6d0d";
export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
interface Diagnostic {
  start: number;
  end: number;
  message: string;
  help: string;
}
export interface ComponentCase {
  id: string;
  filename: string;
  source: string;
  sourceSha256: string;
  compiler: object;
  nativeOptions: object;
  authoredExpectedPacket: { diagnostics: Diagnostic[]; error_count: number; warning_count: number };
}
export function cases(bytes: Uint8Array): ComponentCase[] {
  assert.equal(sha256(bytes), componentCorpusSHA256, "original complete corpus required");
  const corpus = JSON.parse(Buffer.from(bytes).toString("utf8")) as { cases: ComponentCase[] };
  assert.equal(corpus.cases.length, 30);
  assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, 30);
  for (const entry of corpus.cases) {
    assert.equal(sha256(entry.source), entry.sourceSha256, entry.id);
    assert.equal(path.basename(entry.filename), entry.filename);
    assert.match(entry.id, /^[a-z0-9-]+$/u);
  }
  return corpus.cases;
}
export function config(entry: ComponentCase) {
  return {
    compiler: entry.compiler,
    linter: {
      preset: "incremental",
      rules: { [rule]: "warn" },
      ruleOptions: { [rule]: entry.nativeOptions },
    },
    languageServer: { typecheck: false, editor: false, lint: true },
  };
}
export function write(root: string, filename: string, source: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, filename), source);
}
export function unchanged(root: string, filename: string, source: string) {
  assert.equal(readFileSync(path.join(root, filename), "utf8"), source);
}
export function save(output: string, filename: string, packet: unknown) {
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, filename), JSON.stringify(packet, null, 2) + "\n");
}
function position(source: string, byte: number, utf16: boolean) {
  const bytes = Buffer.from(source);
  assert.ok(Number.isSafeInteger(byte) && byte >= 0 && byte <= bytes.length);
  const prefix = bytes.subarray(0, byte).toString("utf8");
  assert.ok(
    Buffer.from(prefix).equals(bytes.subarray(0, byte)),
    "coordinate must end on a UTF-8 boundary",
  );
  const parts = prefix.split("\n"),
    tail = parts.at(-1)!;
  return { line: parts.length - 1, character: utf16 ? tail.length : [...tail].length };
}
export function cliPacket(entry: ComponentCase, filename = entry.filename) {
  const expected = entry.authoredExpectedPacket;
  return [
    {
      file: filename,
      messages: expected.diagnostics.map((diagnostic) => {
        const start = position(entry.source, diagnostic.start, false),
          end = position(entry.source, diagnostic.end, false);
        return {
          ruleId: rule,
          ruleDocsPath: "docs/content/rules/vue.md",
          severity: 1,
          message: `[vize:${rule}] ${diagnostic.message}`,
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
          help: diagnostic.help,
        };
      }),
      errorCount: expected.error_count,
      warningCount: expected.warning_count,
    },
  ];
}
export function lspPacket(entry: ComponentCase, uri: string, version: number) {
  return {
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      version,
      diagnostics: entry.authoredExpectedPacket.diagnostics.map((diagnostic) => ({
        range: {
          start: position(entry.source, diagnostic.start, true),
          end: position(entry.source, diagnostic.end, true),
        },
        severity: 2,
        code: rule,
        codeDescription: {
          href: "https://eslint.vuejs.org/rules/require-component-registration.html",
        },
        source: "vize/lint",
        message: `${diagnostic.message}\n\nHelp: ${diagnostic.help}`,
      })),
    },
  };
}
export const policySource = "<template>界😀<my-owned/><my-neighbor/></template>\r\n";
export function policy(elements: string[]) {
  return {
    compiler: { customElements: elements },
    linter: { preset: "incremental", rules: { [rule]: "warn" } },
    languageServer: { editor: false, typecheck: false, lint: true },
  };
}
export function policyCase(elements: string[]): ComponentCase {
  const diagnostics = ["my-owned", "my-neighbor"]
    .filter((tag) => !elements.includes(tag))
    .map((tag) => {
      const index = policySource.indexOf(tag),
        start = Buffer.byteLength(policySource.slice(0, index));
      return {
        start,
        end: start + tag.length,
        message: "Component is used but not explicitly imported",
        help: "Import the component in <script setup> or register it in components option",
      };
    });
  return {
    id: "policy",
    filename: "Policy.vue",
    source: policySource,
    sourceSha256: sha256(policySource),
    compiler: { customElements: elements },
    nativeOptions: {},
    authoredExpectedPacket: { diagnostics, error_count: 0, warning_count: diagnostics.length },
  };
}
