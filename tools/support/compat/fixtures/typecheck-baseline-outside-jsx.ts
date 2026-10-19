import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { resolveWithConfigDir } from "./typecheck-baseline-config-dir.ts";
import {
  isInside,
  isPathSpecifier,
  localPackageTarget,
  owningNodeModulePackage,
  fixtureExtendsResolver,
} from "./typecheck-baseline-local-package.ts";
import { loadTsconfigExtendsChain } from "./typecheck-baseline-extends-chain.ts";
import { isolatedTsconfigOverlayPath } from "./typecheck-baseline-outside-paths.ts";

/**
 * Close the jsx-runtime walk unique isolation cannot retarget (#4461).
 *
 * Unique-link answers `require("vue/jsx-runtime")`. Generated configs also
 * write `jsxImportSource: "../../node_modules/vue"`, which TypeScript resolves
 * from the tsconfig directory and loads Vize's Vue beside the fixture.
 * Overlay `paths` cannot rewrite `compilerOptions.jsxImportSource`. When the
 * fixture already has that package, retarget path specifiers. Package-name
 * sources stay with unique-link. Child replaces parent, matching tsc.
 */

type Rec = Readonly<Record<string, unknown>>;

export interface JsxOverlay {
  readonly path: string;
  readonly jsxImportSource?: string;
  readonly [field: string]: unknown;
}

export function rewriteOutsideJsxImportSource(
  fixtureRoot: string,
  sourceConfigPath: string,
  configDir: string,
): string | null {
  const root = resolve(fixtureRoot);
  const declared = winningJsxImportSource(sourceConfigPath, root);
  if (declared == null) return null;
  if (!isPathSpecifier(declared.specifier)) return null;
  return retargetJsxImportSourcePath(root, declared.dir, configDir, declared.specifier);
}

export function applyIsolatedJsxOverlay(
  fixtureRoot: string,
  sourceConfigPath: string,
  overlay: JsxOverlay | null | undefined,
): JsxOverlay | null {
  const sourcePath = resolve(sourceConfigPath);
  const rewritten = rewriteOutsideJsxImportSource(fixtureRoot, sourcePath, dirname(sourcePath));
  if (rewritten == null) return overlay ?? null;
  const overlayPath = overlay?.path ?? isolatedTsconfigOverlayPath(sourcePath);
  const document = (
    existsSync(overlayPath)
      ? JSON.parse(readFileSync(overlayPath, "utf8"))
      : { extends: `./${basename(sourcePath)}` }
  ) as Record<string, unknown>;
  document.compilerOptions = { ...(document.compilerOptions as Rec), jsxImportSource: rewritten };
  writeFileSync(overlayPath, `${JSON.stringify(document, null, 2)}\n`);
  return { ...overlay, path: overlayPath, jsxImportSource: rewritten };
}

export function applyIsolatedJsxBaseline(
  fixtureRoot: string,
  sourceConfigPath: string,
  baselinePath: string,
): string | null {
  const rewritten = rewriteOutsideJsxImportSource(
    fixtureRoot,
    resolve(sourceConfigPath),
    dirname(resolve(baselinePath)),
  );
  if (rewritten == null) return null;
  const document = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, unknown>;
  document.compilerOptions = { ...(document.compilerOptions as Rec), jsxImportSource: rewritten };
  writeFileSync(baselinePath, `${JSON.stringify(document, null, 2)}\n`);
  return rewritten;
}

function retargetJsxImportSourcePath(
  fixtureRoot: string,
  sourceDir: string,
  configDir: string,
  entry: string,
): string | null {
  const original = resolveWithConfigDir(sourceDir, sourceDir, entry);
  if (isInside(fixtureRoot, original)) return null;
  const owned = owningNodeModulePackage(original);
  if (owned == null) return null;
  return localPackageTarget(fixtureRoot, configDir, owned.name, relative(owned.root, original));
}

function winningJsxImportSource(
  sourceConfigPath: string,
  fixtureRoot: string,
): { specifier: string; dir: string } | null {
  let specifier: string | null = null;
  let dir = "";
  for (const { config, dir: configDir } of [
    ...loadTsconfigExtendsChain(sourceConfigPath, fixtureExtendsResolver(fixtureRoot)),
  ].reverse()) {
    const options = config.compilerOptions;
    const candidate: unknown =
      options != null && typeof options === "object" ? (options as Rec).jsxImportSource : undefined;
    if (typeof candidate !== "string") continue;
    specifier = candidate;
    dir = configDir;
  }
  return specifier == null ? null : { specifier, dir };
}
