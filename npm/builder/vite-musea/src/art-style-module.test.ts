import assert from "node:assert/strict";
import test from "node:test";

import { artScopeAttribute } from "./art-style.js";
import {
  artStyleRequestId,
  loadArtStyle,
  parseArtStyleRequest,
  transformPreprocessedArtStyle,
} from "./art-style-module.js";
import type { ArtFileInfo, ArtStyleBlock } from "./types/index.js";

function artWith(style: ArtStyleBlock): ArtFileInfo {
  return {
    path: "/repo/Card.art.vue",
    metadata: { title: "Card", tags: [], status: "ready" },
    variants: [],
    hasScriptSetup: false,
    hasScript: false,
    styleCount: 1,
    styleBlocks: [style.content],
    styleBlockDetails: [style],
  };
}

void test("art style requests retain Vite's visible language extension", () => {
  const style = { content: "$gap: 4px; .card { padding: $gap; }", lang: "scss", scoped: true };
  const scope = artScopeAttribute("/repo/Card.art.vue");
  const id = artStyleRequestId("/repo/Card.art.vue", 0, style, scope);
  assert.match(id, /\.__musea_style_0\.scss\?/);
  assert.deepEqual(parseArtStyleRequest(`\0${id}`), {
    filePath: "/repo/Card.art.vue",
    index: 0,
    lang: "scss",
    scoped: scope,
  });
  assert.equal(loadArtStyle(artWith(style), parseArtStyleRequest(id)), style.content);
});

void test("plain art CSS is scoped before it enters Vite's PostCSS pipeline", () => {
  const style = { content: ".card { color: magic; }", lang: "css", scoped: true };
  const scope = artScopeAttribute("/repo/Card.art.vue");
  const id = artStyleRequestId("/repo/Card.art.vue", 0, style, scope);
  const loaded = loadArtStyle(artWith(style), parseArtStyleRequest(id), (css, scopeId) =>
    css.replace(".card", `.card[${scopeId}]`),
  );
  assert.match(loaded ?? "", new RegExp(`\\.card\\[${scope}\\]`));
  assert.match(loaded ?? "", /color: magic/);
});

void test("preprocessed art CSS is scoped after Vite lowers it", () => {
  const style = { content: ".card { & > span { color: red; } }", lang: "scss", scoped: true };
  const scope = artScopeAttribute("/repo/Card.art.vue");
  const id = artStyleRequestId("/repo/Card.art.vue", 0, style, scope);
  const transformed = transformPreprocessedArtStyle(
    ".card > span { color: red; }",
    id,
    (css, scopeId) => css.replace(".card > span", `.card[${scopeId}] > span[${scopeId}]`),
  );
  assert.match(transformed ?? "", new RegExp(`\\.card\\[${scope}\\] > span\\[${scope}\\]`));
});
