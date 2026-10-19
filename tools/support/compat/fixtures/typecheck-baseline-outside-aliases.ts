import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { resolveWithConfigDir } from "./typecheck-baseline-config-dir.ts";
import {
  configRelativePath,
  isInside,
  owningNodeModulePackage,
  fixtureExtendsResolver,
} from "./typecheck-baseline-local-package.ts";
import { loadTsconfigExtendsChain } from "./typecheck-baseline-extends-chain.ts";
import {
  isolatedOverlayBaseUrl,
  isolatedTsconfigOverlayPath,
  pathMappingRoot,
} from "./typecheck-baseline-outside-paths.ts";
import { rewriteOutsideVueCompilerOptions } from "./typecheck-baseline-outside-vue-compiler.ts";
import { rewriteOutsideCompilerPlugins } from "./typecheck-baseline-outside-compiler-plugins.ts";
import {
  mergeLocalVueRuntimePaths,
  rewriteLocalVueRuntimePaths,
} from "./typecheck-baseline-outside-vue-runtime-paths.ts";

/**
 * Close the remaining `compilerOptions.paths` escape for keys that are not
 * package names (#4461). Unique isolation and the package-name overlay only
 * retarget `vue-router`. Nuxt still writes `#app` / `#imports` onto files
 * *above* the fixture, so vue-tsc loads Vize's Nuxt and then Vize's Vue.
 *
 * A mapping is retargeted only when its target sits under an outside
 * `node_modules/<name>` (or `@scope/name`) directory and the fixture already
 * has that package. Interior `*` patterns are not guessed. When the generated
 * baseline config is placed in another directory, every emitted mapping is also
 * relocated to that config directory so inherited relative aliases keep their
 * source meaning.
 *
 * Package-name `extends` is followed only inside the fixture, matching the
 * package-name overlay. Climbing into Vize would load Vize's `#app` mappings.
 */

type Rec = Readonly<Record<string, unknown>>;
type PathTargets = Record<string, unknown[]>;

export interface IsolatedOverlay {
  readonly path: string;
  readonly paths?: Rec | null;
  readonly typeRoots?: unknown;
  readonly rootDirs?: unknown;
  readonly vueCompilerOptions?: unknown;
  readonly plugins?: unknown;
  readonly [field: string]: unknown;
}

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/u;

export function rewriteOutsideAliasPaths(
  fixtureRoot: string,
  sourceConfigPath: string,
  configDir: string,
): PathTargets | null {
  const root = resolve(fixtureRoot);
  const declared = winningPaths(sourceConfigPath, root);
  if (declared == null) return null;
  const mapping = pathMappingRoot(sourceConfigPath, root, declared.dir);
  const rewritten: PathTargets = {};
  let changed = false;
  for (const [name, value] of Object.entries(declared.paths)) {
    if (!Array.isArray(value)) continue;
    const targets = value as readonly unknown[];
    const remapped = retargetAliasMapping(
      root,
      mapping,
      declared.dir,
      configDir,
      name,
      targets,
      () => {
        changed = true;
      },
    );
    rewritten[name] = remapped;
    if (!isPackageMappingName(name) && !sameStringArray(targets, remapped)) changed = true;
  }
  return changed ? rewritten : null;
}

export function mergePathRewrites(
  packages: Rec | null | undefined,
  aliases: PathTargets | null,
): Rec | null {
  if (packages == null) return aliases;
  if (aliases == null) return packages;
  const merged: Record<string, unknown> = { ...packages };
  for (const [name, targets] of Object.entries(aliases)) {
    if (!isPackageMappingName(name)) merged[name] = targets;
  }
  return merged;
}

export function applyIsolatedAliasOverlay(
  fixtureRoot: string,
  sourceConfigPath: string,
  overlay: IsolatedOverlay | null | undefined,
): IsolatedOverlay | null {
  const sourcePath = resolve(sourceConfigPath);
  const configDir = dirname(sourcePath);
  const aliases = rewriteOutsideAliasPaths(fixtureRoot, sourcePath, configDir);
  const vueCompilerOptions = rewriteOutsideVueCompilerOptions(fixtureRoot, sourcePath, configDir);
  const plugins = rewriteOutsideCompilerPlugins(fixtureRoot, sourcePath, configDir);
  const runtimePaths = rewriteLocalVueRuntimePaths(fixtureRoot, configDir);
  if (aliases == null && vueCompilerOptions == null && plugins == null && runtimePaths == null) {
    return overlay ?? null;
  }
  const paths = mergeLocalVueRuntimePaths(
    mergePathRewrites(overlay?.paths ?? null, aliases),
    runtimePaths,
  );
  const typeRoots = overlay?.typeRoots ?? null;
  const rootDirs = overlay?.rootDirs ?? null;
  const overlayPath = overlay?.path ?? isolatedTsconfigOverlayPath(sourcePath);
  const compilerOptions: Record<string, unknown> = {};
  if (paths != null) compilerOptions.paths = paths;
  if (typeRoots != null) compilerOptions.typeRoots = typeRoots;
  if (rootDirs != null) compilerOptions.rootDirs = rootDirs;
  if (plugins != null) compilerOptions.plugins = plugins;
  if (paths != null && isolatedOverlayBaseUrl(sourcePath, fixtureRoot) != null) {
    compilerOptions.baseUrl = ".";
  }
  const document: Record<string, unknown> = { extends: `./${basename(sourcePath)}` };
  if (Object.keys(compilerOptions).length > 0) document.compilerOptions = compilerOptions;
  if (vueCompilerOptions != null) document.vueCompilerOptions = vueCompilerOptions;
  writeFileSync(overlayPath, `${JSON.stringify(document, null, 2)}\n`);
  return { path: overlayPath, paths, typeRoots, rootDirs, vueCompilerOptions, plugins };
}

function retargetAliasMapping(
  fixtureRoot: string,
  sourceDir: string,
  tsconfigDir: string,
  configDir: string,
  name: string,
  targets: readonly unknown[],
  markChanged: () => void,
): unknown[] {
  const relocated = targets.map((entry) =>
    relocatePathEntry(sourceDir, tsconfigDir, configDir, entry),
  );
  if (isPackageMappingName(name)) return relocated;
  const first = targets.find(
    (entry): entry is string => typeof entry === "string" && isExactOrTrailingStarPath(entry),
  );
  if (first == null) return relocated;
  const star = first.endsWith("/*");
  const original = resolveWithConfigDir(sourceDir, tsconfigDir, star ? first.slice(0, -2) : first);
  if (isInside(fixtureRoot, original)) return relocated;
  const owned = owningNodeModulePackage(original);
  if (owned == null || isInside(fixtureRoot, owned.root)) return relocated;
  const local = join(fixtureRoot, "node_modules", ...owned.name.split("/"));
  if (!existsSync(join(local, "package.json"))) return relocated;
  const subpath = relative(owned.root, original).replaceAll("\\", "/");
  if (subpath.startsWith("..") || subpath.startsWith("/")) return relocated;
  const localTarget = subpath === "" ? local : join(local, subpath);
  markChanged();
  const rewritten = star
    ? `${configRelativePath(configDir, localTarget)}/*`
    : configRelativePath(configDir, localTarget);
  return relocated.map((entry, index) => (index === targets.indexOf(first) ? rewritten : entry));
}

function isPackageMappingName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const base = name.endsWith("/*") ? name.slice(0, -2) : name;
  return packageNamePattern.test(base);
}

function isExactOrTrailingStarPath(entry: string): boolean {
  return !entry.includes("*") || (entry.endsWith("/*") && !entry.slice(0, -2).includes("*"));
}

function relocatePathEntry(
  sourceDir: string,
  tsconfigDir: string,
  configDir: string,
  entry: unknown,
): unknown {
  if (typeof entry !== "string") return entry;
  if (!entry.includes("*")) {
    return configRelativePath(configDir, resolveWithConfigDir(sourceDir, tsconfigDir, entry));
  }
  if (entry.endsWith("/*") && !entry.slice(0, -2).includes("*")) {
    return `${configRelativePath(
      configDir,
      resolveWithConfigDir(sourceDir, tsconfigDir, entry.slice(0, -2)),
    )}/*`;
  }
  return entry;
}

function winningPaths(
  sourceConfigPath: string,
  fixtureRoot: string,
): { paths: Rec; dir: string } | null {
  let paths: Rec | null = null;
  let dir = "";
  for (const { config, dir: configDir } of [
    ...loadTsconfigExtendsChain(sourceConfigPath, fixtureExtendsResolver(fixtureRoot)),
  ].reverse()) {
    const options = config.compilerOptions;
    const candidate: unknown =
      options != null && typeof options === "object" ? (options as Rec).paths : undefined;
    if (candidate != null && typeof candidate === "object") {
      paths = candidate as Rec;
      dir = configDir;
    }
  }
  return paths == null ? null : { paths, dir };
}

function sameStringArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}
