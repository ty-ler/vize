import type { NuxtLintConfigItem } from "@vizejs/nuxt-lint-config";
import path from "node:path";

/** Hook other Nuxt modules use to extend Vize's generated lint config. */
export const VIZE_NUXT_LINT_CONFIG_ADDONS_HOOK = "vize:lint:config:addons" as const;

/** A synchronous or asynchronous addon result, matching Nuxt hook conventions. */
export type NuxtLintAwaitable<T> = T | Promise<T>;

/** The import identity exposed by Nuxt and Nitro's unimport registries. */
export interface NuxtLintImport {
  from: string;
  name: string;
  as?: string;
}

interface NuxtLintImportContext {
  getImports(): NuxtLintAwaitable<readonly NuxtLintImport[]>;
}

/** One extension of the generated, engine-neutral lint config plan. */
export interface NuxtLintConfigAddon {
  name: string;
  getConfigs(): NuxtLintAwaitable<readonly NuxtLintConfigItem[] | undefined>;
}

/** Nuxt options that decide whether an unimport registry is actually injected. */
export interface NuxtLintAutoImportOptions {
  rootDir?: string;
  imports?: false | { autoImport?: boolean };
  nitro?: { imports?: false | { autoImport?: boolean }; srcDir?: string };
  _layers?: Array<{ config?: { rootDir?: string } }>;
}

export interface NuxtLintConfigAddonsOptions {
  /** Directory generated lint globs are relative to. */
  rootDir?: string;
}

/** The Nuxt hook surface used by lint config addons. */
export interface NuxtLintConfigAddonNuxt {
  options?: NuxtLintAutoImportOptions;
  hook(name: "imports:context" | "nitro:init", callback: (value: unknown) => unknown): void;
  callHook(
    name: typeof VIZE_NUXT_LINT_CONFIG_ADDONS_HOOK,
    addons: NuxtLintConfigAddon[],
  ): NuxtLintAwaitable<void>;
}

/** Resolve the config items contributed by the current addon registry. */
export type ResolveNuxtLintConfigAddons = () => Promise<readonly NuxtLintConfigItem[]>;

function autoImportEnabled(imports: false | { autoImport?: boolean } | undefined): boolean {
  if (imports === false) return false;
  return imports?.autoImport !== false;
}

function asImportContext(value: unknown): NuxtLintImportContext | undefined {
  if (value == null || typeof value !== "object" || !("getImports" in value)) {
    return undefined;
  }
  return typeof value.getImports === "function" ? (value as NuxtLintImportContext) : undefined;
}

function nitroImportContext(value: unknown): NuxtLintImportContext | undefined {
  if (value == null || typeof value !== "object" || !("unimport" in value)) {
    return undefined;
  }
  return asImportContext(value.unimport);
}

/**
 * Capture Nuxt's client and server auto-import registries as readonly globals.
 *
 * Nuxt publishes both contexts after modules have begun setting up. Keeping
 * their latest values in the addon means every config regeneration observes
 * the current registry rather than a module-setup-time snapshot.
 */
function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function nitroImportFiles(
  nuxt: NuxtLintConfigAddonNuxt,
  options: NuxtLintConfigAddonsOptions,
): string[] {
  const nuxtRoot = path.resolve(nuxt.options?.rootDir ?? options.rootDir ?? ".");
  const lintRoot = path.resolve(options.rootDir ?? nuxtRoot);
  const directories = new Set<string>();
  directories.add(path.resolve(nuxtRoot, nuxt.options?.nitro?.srcDir ?? "server"));
  for (const layer of nuxt.options?._layers ?? []) {
    if (layer.config?.rootDir) directories.add(path.resolve(layer.config.rootDir, "server"));
  }
  return [...directories]
    .map(
      (directory) => `${toPosix(path.relative(lintRoot, directory)) || "."}/**/*.{js,ts,jsx,tsx}`,
    )
    .sort();
}

function createNuxtImportGlobalsAddon(
  nuxt: NuxtLintConfigAddonNuxt,
  options: NuxtLintConfigAddonsOptions,
): NuxtLintConfigAddon {
  let unimport: NuxtLintImportContext | undefined;
  let nitroUnimport: NuxtLintImportContext | undefined;

  nuxt.hook("imports:context", (context) => {
    unimport = asImportContext(context);
  });
  nuxt.hook("nitro:init", (nitro) => {
    nitroUnimport = nitroImportContext(nitro);
  });

  return {
    name: "vize:lint:import-globals",
    async getConfigs() {
      const appAutoImports = autoImportEnabled(nuxt.options?.imports);
      const imports = (appAutoImports ? ((await unimport?.getImports()) ?? []) : []).sort(
        (left, right) => left.from.localeCompare(right.from) || left.name.localeCompare(right.name),
      );
      const globals = Object.fromEntries(
        imports.map((imported) => [imported.as ?? imported.name, "readonly"] as const),
      ) as Record<string, "readonly">;

      const nitroImports = (
        appAutoImports && autoImportEnabled(nuxt.options?.nitro?.imports)
          ? ((await nitroUnimport?.getImports()) ?? [])
          : []
      ).sort(
        (left, right) => left.from.localeCompare(right.from) || left.name.localeCompare(right.name),
      );
      const nitroGlobals = Object.fromEntries(
        nitroImports.map((imported) => [imported.as ?? imported.name, "readonly"] as const),
      ) as Record<string, "readonly">;

      return [
        { name: "nuxt/import-globals", globals },
        ...(Object.keys(nitroGlobals).length > 0
          ? [
              {
                name: "nitro/import-globals",
                files: nitroImportFiles(nuxt, options),
                globals: nitroGlobals,
              },
            ]
          : []),
      ];
    },
  };
}

/**
 * Register the built-in auto-import addon and return the generation-time
 * resolver consumed by the Nuxt lint config writer.
 *
 * The addon array is rebuilt for every generation. This mirrors Nuxt's addon
 * hook without retaining contributions across `builder:generateApp` runs.
 * The Vize-namespaced hook carries engine-neutral config items instead of raw
 * ESLint source, so contributors remain compatible with the oxlint emitter.
 */
export function setupNuxtLintConfigAddons(
  nuxt: NuxtLintConfigAddonNuxt,
  options: NuxtLintConfigAddonsOptions = {},
): ResolveNuxtLintConfigAddons {
  const defaults = [createNuxtImportGlobalsAddon(nuxt, options)] satisfies NuxtLintConfigAddon[];

  return async () => {
    const addons = [...defaults];
    await nuxt.callHook(VIZE_NUXT_LINT_CONFIG_ADDONS_HOOK, addons);

    const configs: NuxtLintConfigItem[] = [];
    for (const addon of addons) {
      const contributed = await addon.getConfigs();
      if (contributed) {
        configs.push(...contributed);
      }
    }
    return configs;
  };
}
