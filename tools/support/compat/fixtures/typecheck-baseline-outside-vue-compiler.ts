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
import { packageNameFromExtendsSpecifier } from "./typecheck-baseline-isolation-package-extends.ts";

/**
 * Close the vue-tsc option escape unique isolation cannot see (#4461).
 *
 * `vueCompilerOptions.globalTypesPath`, `typesRoot`, and path-form `plugins`
 * are filesystem or package walks. Overlay `compilerOptions` cannot retarget
 * them. An outside path still loads Vize's `@vue/language-core` or
 * `require("../../node_modules/<pkg>")` beside the fixture Vue. Unique-link
 * answers package-name plugins; relative plugin specifiers still walk out.
 * When the fixture already has that package, this copies every winning
 * `vueCompilerOptions` key and retargets those paths. Overlay replaces the
 * object, so other keys must be preserved. Plugin lists are concatenated
 * across relative extends, matching vue-tsc.
 */

type Rec = Readonly<Record<string, unknown>>;
interface Retargeted {
  readonly value: unknown;
  readonly changed: boolean;
}

const pathOptionKeys = ["globalTypesPath", "typesRoot"] as const;

export function rewriteOutsideVueCompilerOptions(
  fixtureRoot: string,
  sourceConfigPath: string,
  configDir: string,
): Record<string, unknown> | null {
  const root = resolve(fixtureRoot);
  const declared = winningVueCompilerOptions(sourceConfigPath, root);
  if (declared == null) return null;
  const rewritten: Record<string, unknown> = { ...declared.options };
  let changed = false;
  for (const key of pathOptionKeys) {
    const entry = declared.options[key];
    if (typeof entry !== "string") continue;
    const retargeted = retargetVueCompilerPath(root, declared.dirs[key] ?? root, configDir, entry);
    if (retargeted == null) continue;
    rewritten[key] = retargeted;
    changed = true;
  }
  const plugins: unknown[] = [];
  for (const { plugin, dir } of declared.plugins) {
    const next = retargetPluginEntry(root, dir, configDir, plugin);
    if (next.changed) changed = true;
    plugins.push(next.value);
  }
  if (plugins.length > 0) rewritten.plugins = plugins;
  return changed ? rewritten : null;
}

function retargetPluginEntry(
  fixtureRoot: string,
  sourceDir: string,
  configDir: string,
  plugin: unknown,
): Retargeted {
  if (typeof plugin === "string") {
    return retargetPluginName(fixtureRoot, sourceDir, configDir, plugin, plugin);
  }
  const first: unknown = Array.isArray(plugin) ? plugin[0] : undefined;
  if (Array.isArray(plugin) && typeof first === "string") {
    const next = retargetPluginName(fixtureRoot, sourceDir, configDir, first, plugin);
    if (!next.changed) return next;
    return { value: [next.value, ...(plugin as readonly unknown[]).slice(1)], changed: true };
  }
  const record = plugin != null && typeof plugin === "object" ? (plugin as Rec) : null;
  if (record != null && typeof record.name === "string") {
    const next = retargetPluginName(fixtureRoot, sourceDir, configDir, record.name, plugin);
    if (!next.changed) return next;
    return { value: { ...record, name: next.value }, changed: true };
  }
  return { value: plugin, changed: false };
}

function retargetPluginName(
  fixtureRoot: string,
  sourceDir: string,
  configDir: string,
  name: string,
  fallback: unknown,
): Retargeted {
  const normalized = name.replaceAll("\\", "/");
  if (!isPathSpecifier(normalized)) return { value: fallback, changed: false };
  const retargeted = retargetVueCompilerPath(fixtureRoot, sourceDir, configDir, normalized);
  return retargeted == null
    ? { value: fallback, changed: false }
    : { value: retargeted, changed: true };
}

function retargetVueCompilerPath(
  fixtureRoot: string,
  sourceDir: string,
  configDir: string,
  entry: string,
): string | null {
  if (isPathSpecifier(entry)) {
    const original = resolveWithConfigDir(sourceDir, sourceDir, entry);
    if (isInside(fixtureRoot, original)) return null;
    const owned = owningNodeModulePackage(original);
    if (owned == null) return null;
    return localPackageTarget(fixtureRoot, configDir, owned.name, relative(owned.root, original));
  }
  const name = packageNameFromExtendsSpecifier(entry);
  if (name == null) return null;
  const rest = entry.startsWith(`${name}/`) ? entry.slice(name.length + 1) : "";
  return localPackageTarget(fixtureRoot, configDir, name, rest);
}

function winningVueCompilerOptions(
  sourceConfigPath: string,
  fixtureRoot: string,
): {
  options: Record<string, unknown>;
  dirs: Record<string, string>;
  plugins: { plugin: unknown; dir: string }[];
} | null {
  const options: Record<string, unknown> = {};
  const dirs: Record<string, string> = {};
  const plugins: { plugin: unknown; dir: string }[] = [];
  for (const { config, dir } of [
    ...loadTsconfigExtendsChain(sourceConfigPath, fixtureExtendsResolver(fixtureRoot)),
  ].reverse()) {
    const value = config.vueCompilerOptions;
    if (value == null || typeof value !== "object" || Array.isArray(value)) continue;
    const current = value as Rec;
    for (const [key, value] of Object.entries(current)) {
      if (key === "plugins") continue;
      options[key] = value;
      dirs[key] = dir;
    }
    if (Array.isArray(current.plugins)) {
      for (const plugin of current.plugins as readonly unknown[]) plugins.push({ plugin, dir });
    }
  }
  return Object.keys(options).length === 0 && plugins.length === 0
    ? null
    : { options, dirs, plugins };
}
