import type { ArtFileInfo, ArtStyleBlock } from "./types/index.js";
import { loadNative } from "./native-loader.js";

const STYLE_MARKER = ".__musea_style_";

export function artStyleRequestId(
  filePath: string,
  index: number,
  style: ArtStyleBlock,
  scopeAttr?: string,
): string {
  const params = new URLSearchParams({
    "musea-art-style": "",
    "musea-file": filePath,
    index: String(index),
    lang: style.lang,
  });
  if (style.scoped && scopeAttr) params.set("scoped", scopeAttr);
  return `${filePath}${STYLE_MARKER}${index}.${style.lang}?${params}`;
}

export function parseArtStyleRequest(
  id: string,
): { filePath: string; index: number; lang: string; scoped?: string } | null {
  const normalized = id.startsWith("\0") ? id.slice(1) : id;
  const queryIndex = normalized.indexOf("?");
  if (queryIndex < 0 || !normalized.slice(0, queryIndex).includes(STYLE_MARKER)) return null;
  const params = new URLSearchParams(normalized.slice(queryIndex + 1));
  if (!params.has("musea-art-style")) return null;
  const filePath = params.get("musea-file");
  const index = Number(params.get("index"));
  const lang = params.get("lang");
  if (!filePath || !Number.isInteger(index) || index < 0 || !lang) return null;
  return { filePath, index, lang, scoped: params.get("scoped") ?? undefined };
}

export function loadArtStyle(
  art: ArtFileInfo | undefined,
  request: ReturnType<typeof parseArtStyleRequest>,
  scopeCss: (css: string, scopeId: string) => string = defaultScopeCss,
): string | null {
  if (!art || !request) return null;
  const style =
    art.styleBlockDetails?.[request.index] ??
    (art.styleBlocks?.[request.index]
      ? { content: art.styleBlocks[request.index], lang: "css", scoped: false }
      : undefined);
  if (!style || style.lang !== request.lang) return null;

  // Plain CSS can be scoped before Vite processes PostCSS syntax. Preprocessor
  // languages are scoped by the companion transform after Vite lowers them.
  if (request.scoped && style.scoped && style.lang === "css") {
    return scopeCss(style.content, request.scoped);
  }
  return style.content;
}

export function transformPreprocessedArtStyle(
  code: string,
  id: string,
  scopeCss: (css: string, scopeId: string) => string = defaultScopeCss,
): string | null {
  const request = parseArtStyleRequest(id);
  if (!request?.scoped || request.lang === "css") return null;
  return scopeCss(code, request.scoped);
}

function defaultScopeCss(css: string, scopeId: string): string {
  return loadNative().scopeViteCssForPipeline?.(css, scopeId) ?? css;
}
