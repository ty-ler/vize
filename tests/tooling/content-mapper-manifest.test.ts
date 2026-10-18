import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("vize package exposes an executable TypeScript content mapper", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "npm/cli/package.json"), "utf-8"),
  ) as {
    bin?: Record<string, string>;
    files?: string[];
    tsContentMapper?: unknown;
    typescript?: {
      contentMapper?: {
        dynamicConfig?: boolean;
        compilerOptions?: string[];
        exec?: string[];
      };
    };
  };
  const binPath = path.join(root, "npm/cli/bin/vize");

  assert.deepEqual(packageJson.typescript?.contentMapper, {
    dynamicConfig: true,
    exec: ["node", "./bin/vize", "content-mapper"],
    compilerOptions: ["noUnusedLocals"],
  });
  assert.equal(
    packageJson.tsContentMapper,
    undefined,
    "the retired tsContentMapper key must not ship alongside typescript.contentMapper",
  );
  assert.equal(packageJson.bin?.vize, "bin/vize");
  assert.ok(packageJson.files?.includes("bin"));
  assert.notEqual(
    fs.statSync(binPath).mode & 0o111,
    0,
    "content mapper entrypoint must be executable",
  );
  assert.match(fs.readFileSync(binPath, "utf-8"), /^#!\/usr\/bin\/env node\n/);
});

test("VS Code discovers Vize through the trusted native preview command", () => {
  const discovery = fs.readFileSync(
    path.join(root, "editors/vscode/src/content-mapper-discovery.ts"),
    "utf-8",
  );

  assert.match(discovery, /extensions\.getExtension\("TypeScriptTeam\.native-preview"\)/);
  assert.match(
    discovery,
    /commands\.executeCommand\(\s*"typescript\.native-preview\.discoverContentMappers"/,
  );
  assert.match(discovery, /workspace\.isTrusted/);
  assert.match(discovery, /extensions: \["\.vue"\]/);
});

test("native mapper fixtures preserve the complete production capability contract", () => {
  const production = JSON.parse(fs.readFileSync(path.join(root, "npm/cli/package.json"), "utf8"))
    .typescript.contentMapper;
  const testRoot = path.join(root, "crates/vize/tests");
  const contracts: Array<{ source: string; manifest: Record<string, unknown> }> = [];
  for (const relative of fs.readdirSync(testRoot, { recursive: true }).sort()) {
    if (!relative.startsWith("content_mapper") || !relative.endsWith(".rs")) continue;
    const source = fs.readFileSync(path.join(testRoot, relative), "utf8");
    for (const match of source.matchAll(
      /"exec"\s*:\s*\[env!\("CARGO_BIN_EXE_vize"\),\s*"content-mapper"\]/g,
    )) {
      const start = source.lastIndexOf("{", match.index);
      const end = source.indexOf("}", match.index);
      assert.ok(start >= 0 && end > start);
      const literal = source
        .slice(start, end + 1)
        .replace('env!("CARGO_BIN_EXE_vize")', JSON.stringify("<vize-test-bin>"))
        .replace(/,\s*([}\]])/g, "$1");
      contracts.push({ source: relative.replaceAll(path.sep, "/"), manifest: JSON.parse(literal) });
    }
  }
  assert.deepEqual(
    contracts.map(({ source }) => source),
    [
      "content_mapper_importer_scoped_packages.rs",
      "content_mapper_lsp_support/package_install.rs",
      "content_mapper_tsgo_build.rs",
      "content_mapper_tsgo_cli.rs",
      "content_mapper_tsgo_declaration_lsp.rs",
      "content_mapper_tsgo_directives.rs",
      "content_mapper_tsgo_directives/owner_lsp.rs",
      "content_mapper_tsgo_incremental.rs",
      "content_mapper_tsgo_lsp.rs",
      "content_mapper_tsgo_lsp_event_forms.rs",
      "content_mapper_tsgo_package_references.rs",
      "content_mapper_tsgo_watch.rs",
    ],
  );
  for (const { source, manifest } of contracts) {
    assert.deepEqual(
      manifest,
      {
        ...production,
        exec: ["<vize-test-bin>", "content-mapper"],
        ...(Object.hasOwn(manifest, "name") ? { name: "vize" } : {}),
      },
      source,
    );
  }
});
