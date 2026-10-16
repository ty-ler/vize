// Embedded by the native loader. The nearest installed project Vite owns loading.
import { lstatSync, realpathSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire, globalPaths } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname as moduleConfigDirectory, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function configModuleImportPath(configURL, windows = process.platform === "win32") {
  return fileURLToPath(configURL, { windows });
}

export async function importConfigModule(configPath, withoutVite) {
  return (
    await importConfigModuleWithDependencies(configPath, nodeModule.registerHooks, withoutVite)
  ).namespace;
}

/** Return the actual loader graph alongside the untouched module namespace. */
export async function importConfigModuleWithDependencies(
  configPath,
  registerModuleHooks = nodeModule.registerHooks,
  withoutVite,
) {
  const configURL = pathToFileURL(configPath);
  const require = createRequire(configURL);
  const searchPaths = require.resolve.paths("vite") ?? [];
  const candidate = searchPaths
    .filter((directory) => !globalPaths.includes(directory))
    .map((directory) => join(directory, "vite"))
    .find((directory) => lstatSync(directory, { throwIfNoEntry: false }) !== undefined);
  // The public CLI can retain its explicit TypeScript transform fallback. Native
  // editor snapshots always request the complete real import graph instead.
  if (candidate === undefined) {
    if (withoutVite) return { namespace: await withoutVite(configURL), dependencies: [configPath] };
    if (typeof registerModuleHooks !== "function") {
      throw new Error(
        "Loading a Vite config without project Vite requires Node.js 22.15 or newer to track imported configuration files. Upgrade Node.js or install Vite in the project.",
      );
    }
    const dependencies = new Set([configPath]);
    const hooks = registerModuleHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        if (result.url.startsWith("file:")) dependencies.add(fileURLToPath(result.url));
        return result;
      },
    });
    try {
      return { namespace: await import(configURL.href), dependencies: [...dependencies] };
    } finally {
      hooks.deregister();
    }
  }
  const viteDirectory = realpathSync(candidate);
  const viteEntry = realpathSync(require.resolve("vite"));
  const entryPath = relative(viteDirectory, viteEntry);
  if (entryPath === ".." || entryPath.startsWith(`..${sep}`) || isAbsolute(entryPath)) {
    throw new Error(`Resolved loader escapes selected project Vite: ${candidate} -> ${viteEntry}`);
  }
  const { loadConfigFromFile } = await import(pathToFileURL(viteEntry).href);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "vize-config-module-")));
  try {
    const adapter = join(temporary, "config.mjs");
    await writeFile(
      adapter,
      `import * as original from ${JSON.stringify(configModuleImportPath(configURL))};\nexport default { namespace: original };\n`,
      { flag: "wx", mode: 0o600 },
    );
    const loaded = await loadConfigFromFile(
      { mode: "development", command: "serve" },
      adapter,
      moduleConfigDirectory(configPath),
      "silent",
      undefined,
      "bundle",
    );
    if (!loaded) throw new Error(`Vite did not load the selected config: ${configPath}`);
    return {
      namespace: loaded.config.namespace,
      dependencies: [
        ...new Set([configPath, ...loaded.dependencies.filter((path) => path !== adapter)]),
      ],
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
