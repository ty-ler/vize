import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import type { ResolveExtends } from "./typecheck-baseline-extends-chain.ts";
import { resolvePackageExtends } from "./typecheck-baseline-outside-paths.ts";

/**
 * Shared path ownership for the isolated-baseline overlays (#4461): every
 * overlay retargets an outside `node_modules` file to the fixture's own copy
 * of the package that owns it, written relative to the overlay config.
 */

export interface OwnedPackage {
  readonly name: string;
  readonly root: string;
}

/** Follow relative `extends` inside the fixture, then package-name `extends`. */
export function fixtureExtendsResolver(fixtureRoot: string): ResolveExtends {
  return (fromConfig, specifier) =>
    resolveRelativeExtends(fromConfig, specifier, fixtureRoot) ??
    resolvePackageExtends(fromConfig, specifier, fixtureRoot);
}

export function resolveRelativeExtends(
  fromConfig: string,
  specifier: unknown,
  fixtureRoot: string,
): string | null {
  if (typeof specifier !== "string") return null;
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) return null;
  const resolved = resolve(dirname(fromConfig), specifier);
  const file = existsSync(resolved)
    ? resolved
    : !resolved.endsWith(".json") && existsSync(`${resolved}.json`)
      ? `${resolved}.json`
      : null;
  if (file == null || !isInside(fixtureRoot, file)) return null;
  return file;
}

export function isPathSpecifier(entry: string): boolean {
  return (
    entry.startsWith("./") ||
    entry.startsWith("../") ||
    entry.startsWith("/") ||
    entry.includes("/node_modules/") ||
    entry.includes("${configDir}")
  );
}

export function localPackageTarget(
  fixtureRoot: string,
  configDir: string,
  name: string,
  subpath: unknown,
): string | null {
  const local = join(fixtureRoot, "node_modules", ...name.split("/"));
  if (!existsSync(join(local, "package.json"))) return null;
  const nested = typeof subpath === "string" ? subpath.replaceAll("\\", "/") : "";
  if (nested.startsWith("..") || nested.startsWith("/")) return null;
  const target = nested === "" ? local : join(local, nested);
  if (nested !== "" && !existsSync(target)) return null;
  return configRelativePath(configDir, target);
}

export function owningNodeModulePackage(resolvedPath: string): OwnedPackage | null {
  let directory = resolvedPath;
  let previous: string | null = null;
  while (directory !== previous) {
    if (existsSync(join(directory, "package.json"))) {
      const owned = nodeModulePackageName(directory);
      if (owned != null) return owned;
    }
    previous = directory;
    directory = dirname(directory);
  }
  return null;
}

function nodeModulePackageName(packageRoot: string): OwnedPackage | null {
  const parent = dirname(packageRoot);
  const grandparent = dirname(parent);
  if (basename(parent) === "node_modules") {
    return { name: basename(packageRoot), root: packageRoot };
  }
  if (basename(grandparent) === "node_modules" && basename(parent).startsWith("@")) {
    return {
      name: `${basename(parent)}/${basename(packageRoot)}`,
      root: packageRoot,
    };
  }
  return null;
}

export function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && !path.startsWith("..") && !path.startsWith("/");
}

export function configRelativePath(from: string, to: string): string {
  const path = relative(from, to).replaceAll("\\", "/");
  if (path.startsWith("/") || /^[A-Za-z]:\//u.test(path)) return path;
  return path.startsWith(".") ? path : `./${path}`;
}
