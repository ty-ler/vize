import { relative, resolve } from "node:path";

import { resolveWithConfigDir } from "./typecheck-baseline-config-dir.ts";
import {
  isInside,
  isPathSpecifier,
  localPackageTarget,
  owningNodeModulePackage,
  fixtureExtendsResolver,
} from "./typecheck-baseline-local-package.ts";
import { loadTsconfigExtendsChain } from "./typecheck-baseline-extends-chain.ts";

/**
 * Close the TypeScript plugin require unique isolation cannot retarget (#4461).
 *
 * Unique-link answers `require("typescript-plugin-css-modules")`. Generated
 * configs also write `{ "name": "../../node_modules/<pkg>" }`, which loads
 * from outside the fixture. Overlay `paths` cannot rewrite
 * `compilerOptions.plugins`. When the fixture already has that package,
 * retarget path-form `{ name }` specifiers. Package-name plugins stay with
 * unique-link. Plugin lists are concatenated across relative extends,
 * matching tsc.
 */

type Rec = Readonly<Record<string, unknown>>;

export function rewriteOutsideCompilerPlugins(
  fixtureRoot: string,
  sourceConfigPath: string,
  configDir: string,
): unknown[] | null {
  const root = resolve(fixtureRoot);
  const declared = winningCompilerPlugins(sourceConfigPath, root);
  if (declared.length === 0) return null;
  let changed = false;
  const plugins = declared.map(({ plugin, dir }) => {
    const next = retargetCompilerPlugin(root, dir, configDir, plugin);
    if (next.changed) changed = true;
    return next.value;
  });
  return changed ? plugins : null;
}

function retargetCompilerPlugin(
  fixtureRoot: string,
  sourceDir: string,
  configDir: string,
  plugin: unknown,
): { value: unknown; changed: boolean } {
  const record = plugin != null && typeof plugin === "object" ? (plugin as Rec) : null;
  if (record == null || typeof record.name !== "string") {
    return { value: plugin, changed: false };
  }
  if (!isPathSpecifier(record.name)) return { value: plugin, changed: false };
  const retargeted = retargetCompilerPluginPath(fixtureRoot, sourceDir, configDir, record.name);
  if (retargeted == null) return { value: plugin, changed: false };
  return { value: { ...record, name: retargeted }, changed: true };
}

function retargetCompilerPluginPath(
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

function winningCompilerPlugins(
  sourceConfigPath: string,
  fixtureRoot: string,
): { plugin: unknown; dir: string }[] {
  const plugins: { plugin: unknown; dir: string }[] = [];
  for (const { config, dir } of [
    ...loadTsconfigExtendsChain(sourceConfigPath, fixtureExtendsResolver(fixtureRoot)),
  ].reverse()) {
    const options = config.compilerOptions;
    const current: unknown =
      options != null && typeof options === "object" ? (options as Rec).plugins : undefined;
    if (!Array.isArray(current)) continue;
    for (const plugin of current as readonly unknown[]) plugins.push({ plugin, dir });
  }
  return plugins;
}
