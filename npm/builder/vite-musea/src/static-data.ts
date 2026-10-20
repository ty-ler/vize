import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveSnapshotIdentity } from "./vrt/snapshot-identity.js";
import type { ResolvedConfig } from "vite";

import { handleTokensGet, handleTokensUsage } from "./api-tokens.js";
import {
  handleArtAnalysis,
  handleArtDocs,
  handleArtPalette,
  handleArtSource,
} from "./api-routes/handlers.js";
import { sortedArts } from "./art-order.js";
import type { ApiRoutesContext, SendError, SendJson } from "./api-routes/index.js";
import type { ArtFileInfo } from "./types/index.js";

export interface StaticGalleryPayload {
  arts: ArtFileInfo[];
  snapshotIdentityVersion: 1;
  snapshotIdentities: Record<string, string>;
  previews: Record<string, Record<string, string>>;
  details: Record<string, StaticArtDetails>;
  tokens: unknown;
  tokenUsage: unknown;
}

export interface StaticArtDetails {
  source: unknown;
  palette: unknown;
  analysis: unknown;
  docs: unknown;
}

export interface StaticGalleryDataContext {
  config: ResolvedConfig;
  artFiles: Map<string, ArtFileInfo>;
  scanRoots: string[];
  tokensPath: string | undefined;
  /**
   * Optional outer project root used as an additional allowed boundary for
   * `tokensPath` resolution during static builds.
   */
  projectRoot?: string;
  basePath: string;
  resolvedPreviewCss: string[];
  resolvedPreviewSetup: string | null;
  devSessionToken: string;
}

export function staticPreviewId(artPath: string, variantName: string): string {
  return crypto
    .createHash("sha256")
    .update(artPath)
    .update("\0")
    .update(variantName)
    .digest("hex")
    .slice(0, 20);
}

export function joinUrlPath(basePath: string, ...segments: string[]): string {
  const normalizedBase = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const suffix = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `${normalizedBase}/${suffix}`;
}

export async function createStaticGalleryPayload(
  ctx: StaticGalleryDataContext,
): Promise<StaticGalleryPayload> {
  const apiCtx = createApiContext(ctx);
  const arts = sortedArts(ctx.artFiles.values());
  const previews: StaticGalleryPayload["previews"] = Object.create(null);
  const details: StaticGalleryPayload["details"] = {};
  const snapshotIdentities: Record<string, string> = Object.create(null);
  const snapshotRoot =
    ctx.projectRoot ??
    inferStaticSnapshotRoot(
      ctx.config.root,
      arts.map((art) => art.path),
    );

  for (const art of arts) {
    snapshotIdentities[art.path] = resolveSnapshotIdentity(art.path, snapshotRoot);
    previews[art.path] = Object.create(null);

    for (const variant of art.variants) {
      const id = staticPreviewId(art.path, variant.name);
      previews[art.path][variant.name] = joinUrlPath(ctx.basePath, "preview", `${id}.html`);
    }

    details[art.path] = {
      source: await captureJson(
        (sendJson, sendError) => {
          return handleArtSource(apiCtx, artMatch(art.path), sendJson, sendError);
        },
        { source: "", path: art.path },
      ),
      palette: await captureJson((sendJson, sendError) => {
        return handleArtPalette(apiCtx, artMatch(art.path), sendJson, sendError);
      }, emptyPalette(art)),
      analysis: await captureJson(
        (sendJson, sendError) => {
          return handleArtAnalysis(apiCtx, artMatch(art.path), sendJson, sendError);
        },
        { props: [], emits: [] },
      ),
      docs: await captureJson((sendJson, sendError) => {
        return handleArtDocs(apiCtx, artMatch(art.path), sendJson, sendError);
      }, emptyDocs(art)),
    };
  }

  return {
    arts,
    snapshotIdentityVersion: 1,
    snapshotIdentities,
    previews,
    details,
    tokens: await captureJson((sendJson) => handleTokensGet(apiCtx, sendJson), emptyTokens()),
    tokenUsage: await captureJson((sendJson) => handleTokensUsage(apiCtx, sendJson), {}),
  };
}

function inferStaticSnapshotRoot(viteRoot: string, artPaths: string[]): string {
  let root = path.resolve(viteRoot);
  for (const artPath of artPaths) {
    const directory = path.dirname(path.resolve(artPath));
    while (!isPathInside(root, directory)) {
      const parent = path.dirname(root);
      if (parent === root) {
        throw new Error(
          `Art is outside the Vite root on another filesystem: ${artPath}. Configure projectRoot.`,
        );
      }
      root = parent;
    }
  }
  return root;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function createApiContext(ctx: StaticGalleryDataContext): ApiRoutesContext {
  return {
    config: ctx.config,
    artFiles: ctx.artFiles,
    scanRoots: ctx.scanRoots,
    tokensPath: ctx.tokensPath,
    projectRoot: ctx.projectRoot,
    basePath: ctx.basePath,
    resolvedPreviewCss: ctx.resolvedPreviewCss,
    resolvedPreviewSetup: ctx.resolvedPreviewSetup,
    devSessionToken: ctx.devSessionToken,
    processArtFile: async (filePath: string) => {
      await fs.promises.access(filePath);
    },
    getDevServerPort: () => 5173,
  };
}

async function captureJson<T>(
  run: (sendJson: SendJson, sendError: SendError) => void | Promise<void>,
  fallback: T,
): Promise<unknown> {
  let captured: unknown = fallback;
  const sendJson: SendJson = (data: unknown) => {
    captured = data;
  };
  const sendError: SendError = (message: string, status = 500) => {
    captured = { error: message, status };
  };
  await run(sendJson, sendError);
  return captured;
}

function artMatch(artPath: string): RegExpMatchArray {
  return ["", encodeURIComponent(artPath)] as unknown as RegExpMatchArray;
}

function emptyPalette(art: ArtFileInfo): unknown {
  return {
    title: art.metadata.title,
    controls: [],
    groups: [],
    json: "{}",
    typescript: "",
  };
}

function emptyDocs(art: ArtFileInfo): unknown {
  return {
    markdown: "",
    title: art.metadata.title,
    variant_count: art.variants.length,
  };
}

function emptyTokens(): unknown {
  return {
    categories: [],
    tokenMap: {},
    meta: { filePath: "", tokenCount: 0, primitiveCount: 0, semanticCount: 0 },
  };
}
