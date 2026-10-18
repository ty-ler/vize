import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";

import {
  captureNuxtUiAliveGraphResponse,
  observeNuxtUiModuleGraphs,
  type ModuleGraphHooks,
  type AliveViteServer,
} from "./nuxt-ui-output-authority.ts";
export { fixtureIdentity } from "./nuxt-ui-fixture-identity.ts";

import { authorityDirectory, phase } from "./nuxt-ui-prepared-world.ts";
export {
  authorityDirectory,
  configureNuxtUiAuthority,
  removeOwnedNuxtUiCaches,
  stockNuxtUiCompilerConfig,
} from "./nuxt-ui-prepared-world.ts";

const TARGET =
  /\/(?:Select|SelectRoot|SelectValue|Primitive|Slot)\.(?:vue(?:\.tsx?)?|[cm]?js)(?:\?|$)/;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function write(directory: string, name: string, value: unknown): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function captureNuxtUiServer(pid: number | undefined): void {
  const directory = authorityDirectory();
  const current = phase();
  if (!directory || !current) return;
  assert.ok(pid && Number.isSafeInteger(pid));
  write(path.join(directory, current), `server-${pid}.json`, {
    phase: current,
    pid,
    detachedProcessGroup: pid,
  });
}

export function captureNuxtUiHtml(name: string, raw: string, normalized: string): void {
  const directory = authorityDirectory();
  const current = phase();
  if (!directory || !current) return;
  const target = path.join(directory, current, `html-${name}-${randomUUID()}`);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "raw.html"), raw);
  fs.writeFileSync(path.join(target, "normalized.html"), normalized);
  write(target, "receipt.json", {
    phase: current,
    name,
    rawSha256: sha256(raw),
    normalizedSha256: sha256(normalized),
  });
}

export async function captureNuxtUiAliveGraphs(
  origin: string,
  request: Parameters<typeof captureNuxtUiAliveGraphResponse>[3],
): Promise<void> {
  const directory = authorityDirectory(),
    current = phase();
  if (directory && current)
    await captureNuxtUiAliveGraphResponse(directory, current, origin, request);
}

type TransformContext = { environment?: { name?: string } };
type TransformResult = string | null | undefined | { code: string; map?: unknown };
type Hook = (
  this: TransformContext,
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => TransformResult | Promise<TransformResult>;
type LoadHook = (
  this: TransformContext,
  id: string,
  options?: { ssr?: boolean },
) => TransformResult | Promise<TransformResult>;
type ConfigureHook = (this: TransformContext, server: AliveViteServer) => unknown;
export type CompilerPlugin = {
  name?: string;
  api?: { version?: unknown; options?: { compiler?: { version?: unknown } } };
  transform?: Hook | { handler: Hook; [key: string]: unknown };
  load?: LoadHook | { handler: LoadHook; [key: string]: unknown };
  configureServer?: ConfigureHook | { handler: ConfigureHook; [key: string]: unknown };
};
type PluginValue = CompilerPlugin | CompilerPluginOption[] | false | null | undefined;
export type CompilerPluginOption = PluginValue | Promise<PluginValue>;
async function pluginLeaves(options: CompilerPluginOption[]): Promise<CompilerPlugin[]> {
  const leaves: CompilerPlugin[] = [];
  for (const input of options) {
    const option = await input;
    if (Array.isArray(option)) leaves.push(...(await pluginLeaves(option)));
    else if (option) leaves.push(option);
  }
  return leaves;
}
type Lane = { isClient?: boolean; isServer?: boolean };
type NuxtHooks = ModuleGraphHooks & {
  "vite:configResolved": (
    config: { plugins: CompilerPluginOption[]; root?: string; cacheDir?: string },
    context: Lane,
  ) => void | Promise<void>;
};
type Nuxt = {
  hook: <K extends keyof NuxtHooks>(name: K, callback: NuxtHooks[K]) => void;
};
export function nuxtUiCompilerAuthority(_options: unknown, nuxt: Nuxt): void {
  const directory = authorityDirectory();
  const current = phase();
  assert.ok(directory && current);
  const session = path.join(directory, current, `session-${process.pid}-${randomUUID()}`);
  const registerAliveGraphs = observeNuxtUiModuleGraphs(
    {
      onServer: (callback) => nuxt.hook("vite:serverCreated", callback),
      onClose: (callback) => nuxt.hook("close", callback),
    },
    session,
  );
  let serial = 0;
  nuxt.hook("vite:configResolved", async (config, context) => {
    write(session, `plugin-options-${serial++}.json`, {
      context,
      root: config.root,
      cacheDir: config.cacheDir,
      raw: inspect(config.plugins, {
        depth: null,
        showHidden: true,
        customInspect: false,
        maxArrayLength: null,
        maxStringLength: null,
      }),
    });
    const plugins = await pluginLeaves(config.plugins);
    const isNative = (plugin: CompilerPlugin) =>
      plugin.name === "vite-plugin-vize" ||
      plugin.name?.startsWith("vite-plugin-vize:") ||
      plugin.name?.startsWith("vize:");
    const owners = plugins.filter(
      (plugin) => plugin && (plugin.name === "vite:vue" || isNative(plugin)),
    );
    write(session, `plugins-${serial++}.json`, {
      context,
      root: config.root,
      cacheDir: config.cacheDir,
      names: plugins.map((plugin) => plugin.name),
      owners: owners.map((plugin) => ({
        name: plugin.name,
        version: plugin.api?.version,
        compilerVersion: plugin.api?.options?.compiler?.version,
      })),
    });
    const stock = owners.filter((plugin) => plugin.name === "vite:vue");
    if (current === "reference") {
      assert.equal(stock.length, 1, "stock Nuxt must retain exactly one public vite:vue compiler");
      assert.equal(owners.length, 1, "reference refuses any native Vize compiler plugin");
    } else
      assert.ok(
        owners.some((plugin) => plugin.name === "vite-plugin-vize"),
        "candidate must use the native plugin",
      );
    for (const plugin of owners) {
      const configureServer = plugin.configureServer;
      const original =
        typeof configureServer === "function" ? configureServer : configureServer?.handler;
      const observeServer: ConfigureHook = async function (server) {
        const result = await original?.call(this, server);
        registerAliveGraphs(server, context);
        return result;
      };
      plugin.configureServer =
        configureServer && typeof configureServer === "object"
          ? { ...configureServer, handler: observeServer }
          : observeServer;
      function capture(
        operation: "load" | "transform",
        original: Hook | LoadHook,
        hookContext: TransformContext,
        result: TransformResult,
        id: string,
        options?: { ssr?: boolean },
        input?: string,
      ) {
        const output = typeof result === "string" ? result : result?.code;
        if (!TARGET.test(id) || typeof output !== "string") return;
        const target = path.join(session, `${operation}-${serial++}-${sha256(id)}`);
        fs.mkdirSync(target, { recursive: true });
        if (input !== undefined) fs.writeFileSync(path.join(target, "input.js"), input);
        fs.writeFileSync(path.join(target, "output.js"), output);
        write(target, "receipt.json", {
          phase: current,
          plugin: plugin.name,
          operation,
          id,
          options,
          environment: hookContext.environment?.name,
          nuxtLane: context,
          originalHandlerSha256: sha256(Function.prototype.toString.call(original)),
          inputSha256: input === undefined ? null : sha256(input),
          outputSha256: sha256(output),
          map: typeof result === "object" ? (result?.map ?? null) : null,
        });
      }
      const transform = plugin.transform;
      if (transform) {
        const original = typeof transform === "function" ? transform : transform.handler;
        const observer: Hook = async function (...args) {
          const result = await original.apply(this, args);
          capture("transform", original, this, result, args[1], args[2], args[0]);
          return result;
        };
        plugin.transform =
          typeof transform === "function" ? observer : { ...transform, handler: observer };
      }
      const load = plugin.load;
      if (load) {
        const original = typeof load === "function" ? load : load.handler;
        const observer: LoadHook = async function (...args) {
          const result = await original.apply(this, args);
          capture("load", original, this, result, args[0], args[1]);
          return result;
        };
        plugin.load = typeof load === "function" ? observer : { ...load, handler: observer };
      }
    }
  });
}

export function summarizeNuxtUiTransforms(directory: string, cwd: string) {
  const select = path.join(cwd, "src/runtime/components/Select.vue");
  return (["candidate", "reference"] as const).map((current) => {
    const records: { plugin: string; id: string; ssr: boolean; directory: string }[] = [];
    const phaseDirectory = path.join(directory, current);
    for (const session of fs
      .readdirSync(phaseDirectory)
      .filter((name) => name.startsWith("session-"))) {
      const base = path.join(phaseDirectory, session);
      for (const name of fs.readdirSync(base).filter((name) => /^(?:transform|load)-/.test(name))) {
        const target = path.join(base, name);
        const receipt = JSON.parse(fs.readFileSync(path.join(target, "receipt.json"), "utf8"));
        if (receipt.inputSha256 !== null)
          assert.equal(sha256(fs.readFileSync(path.join(target, "input.js"))), receipt.inputSha256);
        assert.equal(sha256(fs.readFileSync(path.join(target, "output.js"))), receipt.outputSha256);
        const [pathname, query] = receipt.id.split("?");
        const realPath = pathname
          .replace(/^\0vize(?:-ssr)?:/, "")
          .replace(/^\/@fs/, "")
          .replace(/(\.vue)\.tsx?$/, "$1");
        if (realPath !== select || new URLSearchParams(query).get("type") === "style") continue;
        if (current === "reference" && receipt.operation !== "transform") continue;
        const environment = receipt.environment;
        const ssr =
          typeof receipt.options?.ssr === "boolean"
            ? receipt.options.ssr
            : environment === "ssr" || environment === "server"
              ? true
              : environment === "client"
                ? false
                : receipt.nuxtLane?.isServer;
        assert.equal(
          typeof ssr,
          "boolean",
          "compiler target must have an observed SSR/client lane",
        );
        records.push({ plugin: receipt.plugin, id: receipt.id, ssr, directory: target });
      }
    }
    const owner = current === "reference" ? "vite:vue" : "vite-plugin-vize";
    for (const ssr of [false, true]) {
      assert.ok(
        records.some((record) => record.plugin === owner && record.ssr === ssr),
        `${current} must freshly compile the actual upstream Select in both client and SSR lanes`,
      );
    }
    return { phase: current, requiredActualCompiler: owner, actualSelectTransforms: records };
  });
}
