/** Apply the public config migration to an archived, complete documentation packet.
 * Historical fixtures remain byte-for-byte authorities; only current examples use
 * this adapter. It deliberately changes config ownership, never rule/example data.
 */
export function currentConfigExample(original: string): string {
  let source = original
    .replaceAll('from "vize"', 'from "@vizejs/vite-plugin/vite-plus"')
    .replaceAll('import { defineConfig } from "@vizejs/vite-plugin"', 'import { defineConfig } from "@vizejs/vite-plugin/vite-plus"')
    .replace(/(export default defineConfig\(\{\n)  lint: \{\n    vize: \{/g, "$1  vue: {\n    linter: {")
    .replace(/(export default defineConfig\(\{\n)  vize: \{/g, "$1  vue: {")
    .replaceAll("// vize.config.ts", "// vite.config.ts")
    .replaceAll('// vize.config: { compiler: { jsxMode: "vapor" } }', '// vite.config.ts: { vue: { compiler: { jsxMode: "vapor" } } }');
  const native = /\bexport default defineConfig\(\{\n(?=  (?:compiler|typeChecker|linter|formatter|lsp|musea|vite|dialect|experimentals):)/;
  if (native.test(source)) {
    source = source.replace(native, "export default defineConfig({\n  vue: {\n");
    const start = source.indexOf("  vue: {\n") + "  vue: {\n".length;
    const end = source.lastIndexOf("\n});");
    if (end < start) throw new Error("Unrecognized archived config closure");
    source = source.slice(0, start) + source.slice(start, end).replace(/^  /gm, "    ") + "\n  }," + source.slice(end);
  }
  return source;
}

/** Whole rendered Markdown packets use the same finite config-only changes. */
export function currentConfigDocument(original: string): string {
  return original.replace(/^(```[^\n]*\n)([\s\S]*?)(^```[^\n]*$)/gm,
    (_, open: string, code: string, close: string) => open + currentConfigExample(code) + close);
}
