import {
  existsSync,
  lstatSync,
  type Dirent,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  ancestorPackagePath,
  packageNameFromExtendsSpecifier,
} from "./typecheck-baseline-isolation-package-extends.ts";
import { recordCompilerOptionJsxImportSource } from "./typecheck-baseline-isolation-jsx.ts";
import { recordCompilerOptionPlugins } from "./typecheck-baseline-isolation-plugins.ts";
import { recordCompilerOptionTypes } from "./typecheck-baseline-isolation-types.ts";
import { resolveWithConfigDir } from "./typecheck-baseline-config-dir.ts";
import {
  extendsSpecifiers,
  loadTsconfigExtendsChain,
  parseTsconfig,
  type TsconfigLink,
} from "./typecheck-baseline-extends-chain.ts";
import { isInside } from "./typecheck-baseline-local-package.ts";

type Rec = Readonly<Record<string, unknown>>;
const compilerOption = (config: Rec, option: string): unknown => {
  const options = config.compilerOptions;
  return options != null && typeof options === "object" ? (options as Rec)[option] : undefined;
};
import { pathMappingRoot } from "./typecheck-baseline-outside-paths.ts";

/**
 * Keep the fixture's type environment inside the fixture (run 31979524200).
 *
 * A fixture lives at `tests/_fixtures/_git/<id>`, so every `node_modules`
 * directory Vize installs for itself — the repository root's and `tests/`' — is
 * on the fixture's own module resolution path. That is harmless for `import`,
 * because the fixture's config maps what it needs through `compilerOptions.paths`.
 * It is not harmless for `/// <reference types="..." />`: TypeScript resolves a
 * type reference directive by walking `node_modules` upward from the containing
 * file and never consults `paths`, so a package the fixture depends on but its
 * package manager does not link at `<fixture>/node_modules/<name>` escapes the
 * fixture and is satisfied by Vize's copy instead.
 *
 * On run 31979524200 that was elk's `.nuxt/nuxt.d.ts` asking for `vue-router`.
 * pnpm keeps transitive dependencies out of the top level, so the walk reached
 * Vize's `vue-router@4.5.1`, which pulled in Vize's `vue@3.6.0-beta.10` beside
 * elk's own `vue@3.5.30`. With two identities in one program elk's own
 * augmentations stopped reaching its components, and its instance type lost
 * every member Nuxt and vue-i18n contribute. The baseline reported 902
 * diagnostics; with the escape closed it reports 9.
 *
 * The repair is to give the resolver a fixture-local answer before it can leave,
 * and the fixture's own config already says which answer: Nuxt writes
 * `"vue-router": ["../node_modules/.pnpm/vue-router@5.1.0.../node_modules/vue-router"]`
 * into `paths` for exactly this package. So this materializes those declarations
 * as links, rather than choosing a version itself.
 *
 * It is deliberately conservative. A name is linked only when the fixture's
 * config declares it, an ancestor `node_modules` could otherwise answer it, the
 * declared target is a real package directory, and that directory is inside the
 * fixture. Everything else is left alone, and the ambient-environment gate in
 * `typecheck-baseline-ambient.ts` is what proves the outcome — this is the
 * repair, not the check.
 *
 * Declaration comes from `compilerOptions.paths` after relative `extends`, and
 * from relative `references` when that chain declares none — elk's root
 * `tsconfig.json` is solution-style and parks the real paths on referenced
 * `.nuxt` projects (#4461). Conflicting targets for one name are dropped
 * rather than guessed. Package-name `extends` specifiers,
 * `compilerOptions.types` entries, plugin packages, and `jsxImportSource`
 * are recorded as ancestor targets so unique isolation can link a
 * fixture-local copy; those package configs are not walked for `paths`,
 * `types`, plugins, or `jsxImportSource`.
 */

/** `paths` also carries `#imports`-style aliases and `foo/*` patterns, which are not packages. */
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/u;

export interface ShadowedPackage {
  readonly name: string;
  readonly target: string;
}

export function isolateFixtureTypePackages(
  fixtureRoot: string,
  sourceConfigPath: string,
): ShadowedPackage[] {
  const root = resolve(fixtureRoot);
  const declared = readDeclaredPackagePaths(root, sourceConfigPath);
  if (declared.size === 0) return [];
  const reachable = collectAncestorPackageNames(root);
  const shadowed: ShadowedPackage[] = [];
  for (const [name, target] of [...declared].sort(([left], [right]) => compare(left, right))) {
    if (!reachable.has(name)) continue;
    const link = join(root, "node_modules", name);
    if (existsSync(link) || isDanglingLink(link)) continue;
    if (!isPackageDirectory(target) || !isInside(root, target)) continue;
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), target), link);
    shadowed.push({ name, target: relative(root, target).replaceAll("\\", "/") });
  }
  return shadowed;
}

export function readDeclaredPackagePaths(
  fixtureRoot: string,
  sourceConfigPath: string,
): Map<string, string> {
  const declared = new Map<string, string>();
  const conflicts = new Set<string>();
  const seen = new Set<string>();
  const queue = [resolve(sourceConfigPath)];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (seen.has(current)) continue;
    seen.add(current);
    const local = packagePathsFromExtends(fixtureRoot, current);
    if (local.size > 0) {
      mergeDeclared(declared, conflicts, local);
      continue;
    }
    const config = parseTsconfig(current);
    if (config == null) continue;
    for (const specifier of referenceSpecifiers(config.references)) {
      const next = resolveReference(current, specifier);
      if (next == null || !isInside(fixtureRoot, next)) continue;
      queue.push(next);
    }
  }
  mergePackageExtends(declared, conflicts, seen, fixtureRoot);
  return declared;
}

function mergePackageExtends(
  declared: Map<string, string>,
  conflicts: Set<string>,
  configPaths: Iterable<string>,
  fixtureRoot: string,
): void {
  for (const configPath of configPaths) {
    const chain = loadExtendsChain(configPath);
    recordPackageExtends(declared, conflicts, fixtureRoot, chain);
    let types: unknown;
    for (const { config: chained } of [...chain].reverse()) {
      const candidate = compilerOption(chained, "types");
      if (Array.isArray(candidate)) types = candidate;
    }
    recordCompilerOptionTypes(declared, conflicts, fixtureRoot, types);
    recordCompilerOptionPlugins(
      declared,
      conflicts,
      fixtureRoot,
      chain.map(({ config }) => config),
    );
    recordCompilerOptionJsxImportSource(declared, conflicts, fixtureRoot, chain);
  }
}

function recordPackageExtends(
  declared: Map<string, string>,
  conflicts: ReadonlySet<string>,
  fixtureRoot: string,
  chain: readonly TsconfigLink[],
): void {
  for (const { config } of chain) {
    for (const specifier of extendsSpecifiers(config.extends)) {
      const name = packageNameFromExtendsSpecifier(specifier);
      if (name == null || conflicts.has(name) || declared.has(name)) continue;
      const ancestor = ancestorPackagePath(fixtureRoot, name);
      if (ancestor == null) continue;
      declared.set(name, ancestor);
    }
  }
}

function packagePathsFromExtends(
  fixtureRoot: string,
  sourceConfigPath: string,
): Map<string, string> {
  const declared = new Map<string, string>();
  // Child `compilerOptions.paths` replace the parent's object, matching tsc.
  // Targets resolve from last-wins `baseUrl`; `${configDir}` expands first (#4461).
  let paths: Rec | undefined;
  let configDir = "";
  for (const { config, dir } of [...loadExtendsChain(sourceConfigPath)].reverse()) {
    const candidate = compilerOption(config, "paths");
    if (candidate != null && typeof candidate === "object") {
      paths = candidate as Rec;
      configDir = dir;
    }
  }
  if (paths == null) return declared;
  for (const [name, targets] of Object.entries(paths)) {
    if (!packageNamePattern.test(name) || !Array.isArray(targets)) continue;
    const first = (targets as readonly unknown[]).find(
      (entry): entry is string => typeof entry === "string" && !entry.includes("*"),
    );
    if (first == null) continue;
    declared.set(
      name,
      resolveWithConfigDir(
        pathMappingRoot(sourceConfigPath, fixtureRoot, configDir),
        configDir,
        first,
      ),
    );
  }
  return declared;
}

function mergeDeclared(
  declared: Map<string, string>,
  conflicts: Set<string>,
  local: ReadonlyMap<string, string>,
): void {
  for (const [name, target] of local) {
    if (conflicts.has(name)) continue;
    const existing = declared.get(name);
    if (existing === undefined) {
      declared.set(name, target);
      continue;
    }
    if (existing !== target) {
      declared.delete(name);
      conflicts.add(name);
    }
  }
}

function loadExtendsChain(sourceConfigPath: string): TsconfigLink[] {
  return loadTsconfigExtendsChain(sourceConfigPath, resolveExtends);
}

function resolveExtends(fromConfig: string, specifier: unknown): string | null {
  if (typeof specifier !== "string") return null;
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) return null;
  const resolved = resolve(dirname(fromConfig), specifier);
  if (existsSync(resolved)) return resolved;
  if (!resolved.endsWith(".json") && existsSync(`${resolved}.json`)) return `${resolved}.json`;
  return null;
}

function referenceSpecifiers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as readonly unknown[]).flatMap((entry) => {
    const path = entry != null && typeof entry === "object" ? (entry as Rec).path : undefined;
    return typeof path === "string" ? [path] : [];
  });
}

function resolveReference(fromConfig: string, specifier: string): string | null {
  if (typeof specifier !== "string") return null;
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) return null;
  const resolved = resolve(dirname(fromConfig), specifier);
  if (isDirectory(resolved)) {
    const nested = join(resolved, "tsconfig.json");
    return existsSync(nested) ? nested : null;
  }
  if (existsSync(resolved)) return resolved;
  if (!resolved.endsWith(".json") && existsSync(`${resolved}.json`)) return `${resolved}.json`;
  return null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Only names an ancestor could actually answer are linked, so a fixture that is
 * already self-contained is left byte-identical and the repair cannot invent a
 * resolution the real project never had.
 */
export function collectAncestorPackageNames(fixtureRoot: string): Set<string> {
  const names = new Set<string>();
  let directory = dirname(fixtureRoot);
  let previous: string | null = null;
  while (directory !== previous) {
    collectPackageNames(join(directory, "node_modules"), names);
    previous = directory;
    directory = dirname(directory);
  }
  return names;
}

function collectPackageNames(nodeModules: string, names: Set<string>): void {
  for (const entry of readDirectory(nodeModules)) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.name.startsWith("@")) {
      names.add(entry.name);
      continue;
    }
    for (const scoped of readDirectory(join(nodeModules, entry.name))) {
      names.add(`${entry.name}/${scoped.name}`);
    }
  }
}

export function readDirectory(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function isPackageDirectory(target: string): boolean {
  return existsSync(join(target, "package.json"));
}

/** `existsSync` follows symlinks, so a broken link would otherwise be overwritten. */
export function isDanglingLink(link: string): boolean {
  try {
    lstatSync(link);
    return true;
  } catch {
    return false;
  }
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
