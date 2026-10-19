import {
  ancestorPackagePath,
  packageNameFromExtendsSpecifier,
} from "./typecheck-baseline-isolation-package-extends.ts";

type Rec = Readonly<Record<string, unknown>>;
const field = (value: unknown, key: string): unknown =>
  value != null && typeof value === "object" ? (value as Rec)[key] : undefined;

/**
 * `compilerOptions.plugins` and `vueCompilerOptions.plugins` load by climbing
 * `node_modules` (#4461). Overlay cannot retarget that require. Recording the
 * plugin package as an ancestor target lets unique isolation link the
 * fixture's own copy first.
 *
 * Package-name `extends` configs are not read for plugins, matching `paths`
 * and `types`. Relative `extends` chains are unioned: TypeScript concatenates
 * plugin lists rather than replacing the parent object.
 */

export function pluginPackageNamesFromConfigs(configs: unknown): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(configs)) return names;
  for (const config of configs as readonly unknown[]) {
    addCompilerPlugins(names, seen, field(field(config, "compilerOptions"), "plugins"));
    addVueCompilerPlugins(names, seen, field(field(config, "vueCompilerOptions"), "plugins"));
  }
  return names;
}

export function recordCompilerOptionPlugins(
  declared: Map<string, string>,
  conflicts: ReadonlySet<string>,
  fixtureRoot: string,
  configs: unknown,
): void {
  for (const name of pluginPackageNamesFromConfigs(configs)) {
    if (conflicts.has(name) || declared.has(name)) continue;
    const ancestor = ancestorPackagePath(fixtureRoot, name);
    if (ancestor == null) continue;
    declared.set(name, ancestor);
  }
}

function addCompilerPlugins(names: string[], seen: Set<string>, plugins: unknown): void {
  if (!Array.isArray(plugins)) return;
  for (const plugin of plugins as readonly unknown[]) {
    const name = field(plugin, "name");
    if (typeof name !== "string") continue;
    addName(names, seen, name);
  }
}

function addVueCompilerPlugins(names: string[], seen: Set<string>, plugins: unknown): void {
  if (!Array.isArray(plugins)) return;
  for (const plugin of plugins as readonly unknown[]) {
    if (typeof plugin === "string") {
      addName(names, seen, plugin);
      continue;
    }
    const first: unknown = Array.isArray(plugin) ? plugin[0] : undefined;
    if (typeof first === "string") {
      addName(names, seen, first);
      continue;
    }
    const name = field(plugin, "name");
    if (typeof name === "string") {
      addName(names, seen, name);
    }
  }
}

function addName(names: string[], seen: Set<string>, specifier: string): void {
  const name = packageNameFromExtendsSpecifier(specifier);
  if (name == null || seen.has(name)) return;
  seen.add(name);
  names.push(name);
}
