import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build, type Plugin } from "vite";

import { artStyleRequestId, loadArtStyle, parseArtStyleRequest } from "./art-style-module.js";
import type { ArtFileInfo, ArtStyleBlock } from "./types/index.js";

void test("art styles pass through Vite PostCSS, extraction, and minification", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "musea-art-css-pipeline-"));
  const entry = path.join(root, "main.js");
  const artPath = path.join(root, "Badge.art.vue");
  const style: ArtStyleBlock = {
    content: ".badge-art { border-color: magic; padding: 0px 0px 0px 0px; }",
    lang: "css",
    scoped: false,
  };
  const art: ArtFileInfo = {
    path: artPath,
    metadata: { title: "Badge", tags: [], status: "ready" },
    variants: [],
    hasScriptSetup: false,
    hasScript: false,
    styleCount: 1,
    styleBlocks: [style.content],
    styleBlockDetails: [style],
  };
  const requestId = artStyleRequestId(artPath, 0, style);
  const virtualStylePlugin: Plugin = {
    name: "musea-art-style-pipeline-test",
    enforce: "pre",
    resolveId(id) {
      return parseArtStyleRequest(id) ? `\0${id}` : null;
    },
    load(id) {
      return loadArtStyle(art, parseArtStyleRequest(id));
    },
  };

  try {
    await fs.promises.writeFile(entry, `import ${JSON.stringify(requestId)};`);
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      css: {
        postcss: {
          plugins: [
            {
              postcssPlugin: "musea-test-magic",
              Declaration(decl: { value: string }) {
                if (decl.value === "magic") decl.value = "rgb(1, 2, 3)";
              },
            },
          ],
        },
      },
      plugins: [virtualStylePlugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        cssMinify: true,
        rollupOptions: { input: entry },
      },
    });

    const assets = await fs.promises.readdir(path.join(root, "dist", "assets"));
    const cssFile = assets.find((file) => file.endsWith(".css"));
    assert.ok(cssFile, `expected an extracted CSS asset, got ${assets.join(", ")}`);
    const css = await fs.promises.readFile(path.join(root, "dist", "assets", cssFile), "utf8");
    assert.match(css, /\.badge-art\{border-color:#010203;padding:0\}/);
    assert.doesNotMatch(css, /magic|0px 0px 0px 0px/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
