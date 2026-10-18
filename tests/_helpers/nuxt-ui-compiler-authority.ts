import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type Phase = "candidate" | "reference";
type Entry = { path: string; bytes: number; sha256: string };
const CONFIG = "playgrounds/nuxt/nuxt.config.ts";
const COMPILER = "compiler: {\n      handleNodeModulesVue: false,\n    }";
const GENERATED = new Set(["node_modules", ".git", ".nuxt", ".output", ".vize", ".cache", ".vite"]);
const TARGET =
  /\/(?:Select|SelectRoot|SelectValue|Primitive|Slot)\.(?:vue(?:\.tsx?)?|[cm]?js)(?:\?|$)/;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function phase(): Phase | undefined {
  const value = process.env.VIZE_NUXT_UI_COMPILER_PHASE;
  assert.ok(value === undefined || value === "candidate" || value === "reference");
  return value;
}

export function authorityDirectory(): string | undefined {
  if (!phase()) return undefined;
  const directory = process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY;
  assert.ok(
    directory && path.isAbsolute(directory),
    "paired reference needs an absolute authority directory",
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function write(directory: string, name: string, value: unknown): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function inventory(root: string, excluded: ReadonlySet<string>): Entry[] {
  const entries: Entry[] = [];
  function visit(directory: string): void {
    for (const name of fs.readdirSync(directory).sort()) {
      if (excluded.has(name)) continue;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      assert.ok(!stat.isSymbolicLink(), `authority refuses unowned symlink: ${file}`);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) {
        const bytes = fs.readFileSync(file);
        entries.push({
          path: path.relative(root, file),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      } else assert.fail(`authority needs regular source files: ${file}`);
    }
  }
  visit(root);
  return entries;
}

function packageRoot(name: string, importer: string): string {
  const require = createRequire(importer);
  let resolved: string;
  try {
    resolved = require.resolve(`${name}/package.json`);
  } catch {
    resolved = require.resolve(name);
  }
  let directory = path.dirname(fs.realpathSync(resolved));
  for (;;) {
    const file = path.join(directory, "package.json");
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).name === name)
      return directory;
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `missing genuine package ${name}`);
    directory = parent;
  }
}

export function fixtureIdentity(cwd: string) {
  const actual = fs.realpathSync(cwd);
  const playground = path.join(actual, "playgrounds/nuxt/package.json");
  const nuxt = packageRoot("nuxt", playground);
  const builder = packageRoot("@nuxt/vite-builder", path.join(nuxt, "package.json"));
  const plugin = packageRoot("@vitejs/plugin-vue", path.join(builder, "package.json"));
  const vue = packageRoot("vue", playground);
  const providers = [
    ["nuxt", nuxt],
    ["@nuxt/vite-builder", builder],
    ["@vitejs/plugin-vue", plugin],
    ["vue", vue],
    ["@vue/compiler-sfc", packageRoot("@vue/compiler-sfc", path.join(plugin, "package.json"))],
    ["@vue/server-renderer", packageRoot("@vue/server-renderer", path.join(vue, "package.json"))],
    ["reka-ui", packageRoot("reka-ui", path.join(actual, "package.json"))],
  ].map(([name, directory]) => {
    assert.ok(name && directory);
    const stat = fs.statSync(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    return {
      name,
      directory,
      inode: stat.ino,
      device: stat.dev,
      version: manifest.version,
      files: inventory(directory, new Set(["node_modules"])),
    };
  });
  const stat = fs.statSync(actual);
  const source = inventory(actual, GENERATED).filter((entry) => entry.path !== CONFIG);
  return {
    cwd: actual,
    inode: stat.ino,
    device: stat.dev,
    providers,
    source,
    fixture: JSON.parse(fs.readFileSync(path.join(actual, ".vize-fixture-source.json"), "utf8")),
  };
}

export function configureNuxtUiAuthority(configPath: string): void {
  if (!phase()) return;
  let config = fs.readFileSync(configPath, "utf8");
  const helper = fileURLToPath(import.meta.url);
  assert.ok(config.includes(COMPILER), "candidate compiler configuration changed");
  assert.ok(config.includes("    '@nuxt/ui'\n  ],"), "pinned upstream module roster changed");
  config = `import { nuxtUiCompilerAuthority } from ${JSON.stringify(helper)};\n${config}`.replace(
    "    '@nuxt/ui'\n  ],",
    "    '@nuxt/ui',\n    nuxtUiCompilerAuthority,\n  ],",
  );
  fs.writeFileSync(configPath, config);
  write(authorityDirectory()!, "current-fixture.json", {
    cwd: path.resolve(path.dirname(configPath), "../.."),
  });
}

export function prepareNuxtUiReference(cwd: string): boolean {
  if (phase() !== "reference") return false;
  const directory = authorityDirectory();
  assert.ok(directory);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(directory, "candidate-identity.json"), "utf8"),
  );
  assert.deepEqual(
    fixtureIdentity(cwd),
    baseline,
    "same physical source, lock and installed providers required",
  );
  const configPath = path.join(cwd, CONFIG);
  const config = fs.readFileSync(configPath, "utf8");
  assert.equal(config, fs.readFileSync(path.join(directory, "candidate-config.ts"), "utf8"));
  fs.writeFileSync(configPath, stockNuxtUiCompilerConfig(config));
  const observedCacheDirectories = new Set<string>();
  const candidate = path.join(directory, "candidate");
  for (const session of fs.readdirSync(candidate).filter((name) => name.startsWith("session-"))) {
    const sessionPath = path.join(candidate, session);
    for (const name of fs.readdirSync(sessionPath).filter((name) => name.startsWith("plugins-"))) {
      const record = JSON.parse(fs.readFileSync(path.join(sessionPath, name), "utf8"));
      assert.ok(
        typeof record.cacheDir === "string",
        "actual candidate Vite cache path must be recorded",
      );
      const cache = path.resolve(record.cacheDir);
      assert.ok(
        cache.startsWith(`${fs.realpathSync(cwd)}${path.sep}`),
        "refuse clearing caches outside the owned fixture",
      );
      assert.ok(
        cache
          .split(path.sep)
          .some((segment) => [".nuxt", ".cache", ".vite", ".vize"].includes(segment)),
      );
      observedCacheDirectories.add(cache);
    }
  }
  assert.ok(observedCacheDirectories.size > 0);
  const caches = new Set(observedCacheDirectories);
  function collectGenerated(parent: string): void {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const file = path.join(parent, entry.name);
      if (entry.name === "node_modules") {
        for (const name of [".vite", ".cache"]) {
          caches.add(path.join(file, name));
        }
      } else if ([".nuxt", ".output", ".vize", ".cache", ".vite"].includes(entry.name)) {
        caches.add(file);
      } else if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== ".git")
        collectGenerated(file);
    }
  }
  collectGenerated(cwd);
  const removed = removeOwnedNuxtUiCaches(cwd, caches);
  assert.deepEqual(
    fixtureIdentity(cwd),
    baseline,
    "cache removal must preserve every authored/provider byte",
  );
  write(directory, "reference-transition.json", {
    option: "compiler: false",
    removed,
    observedCacheDirectories: [...observedCacheDirectories],
    configBeforeSha256: sha256(config),
    configAfterSha256: sha256(fs.readFileSync(configPath)),
  });
  fs.writeFileSync(path.join(directory, "reference-config.ts"), fs.readFileSync(configPath));
  return true;
}

export function removeOwnedNuxtUiCaches(cwd: string, caches: Iterable<string>): string[] {
  const logical = path.resolve(cwd);
  const physical = fs.realpathSync(cwd);
  function owned(cache: string): string | undefined {
    const absolute = path.resolve(cache);
    const relative = path.relative(
      absolute.startsWith(`${logical}${path.sep}`) ? logical : physical,
      absolute,
    );
    assert.ok(
      relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative),
      "cache must stay inside the owned physical fixture",
    );
    let cursor = physical;
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(cursor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      assert.ok(!stat.isSymbolicLink(), "cache ancestor or leaf must not be a symlink");
      assert.ok(stat.isDirectory(), "cache path must contain only owned directories");
      assert.ok(
        fs.realpathSync(cursor).startsWith(`${physical}${path.sep}`),
        "physical cache escaped fixture",
      );
    }
    return cursor;
  }
  const targets = [
    ...new Set([...caches].map(owned).filter((file): file is string => file !== undefined)),
  ];
  const roots = targets.filter(
    (target) =>
      !targets.some((other) => other !== target && target.startsWith(`${other}${path.sep}`)),
  );
  for (const target of roots) fs.rmSync(target, { recursive: true });
  return roots;
}

export function stockNuxtUiCompilerConfig(config: string): string {
  assert.equal(config.split(COMPILER).length, 2, "exactly one public compiler option changes");
  return config.replace(COMPILER, "compiler: false");
}

export function sealNuxtUiCandidate(cwd: string): void {
  const directory = authorityDirectory();
  assert.ok(directory);
  const identity = fixtureIdentity(cwd);
  write(directory, "candidate-identity.json", identity);
  fs.copyFileSync(path.join(cwd, CONFIG), path.join(directory, "candidate-config.ts"));
  fs.copyFileSync(
    path.join(cwd, "pnpm-lock.yaml"),
    path.join(directory, "provider-pnpm-lock.yaml"),
  );
  const reka = identity.providers.find((provider) => provider.name === "reka-ui");
  assert.ok(reka);
  const modules = reka.files.filter(
    (file) =>
      /(?:SelectRoot|SelectValue|Primitive|Slot)\.(?:[cm]?js|vue)(?:\.map)?$/.test(file.path) ||
      file.path === "package.json" ||
      file.path === "dist/index.js",
  );
  for (const name of ["SelectRoot", "SelectValue", "Primitive", "Slot"]) {
    assert.ok(
      modules.some((file) => path.basename(file.path).startsWith(`${name}.`)),
      `missing actual installed ${name}`,
    );
  }
  for (const file of modules) {
    const target = path.join(directory, "provider-reka-ui", file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(reka.directory, file.path), target);
  }
  fs.copyFileSync(
    path.join(cwd, "src/runtime/components/Select.vue"),
    path.join(directory, "upstream-Select.vue"),
  );
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
export type CompilerPlugin = {
  name?: string;
  api?: { version?: unknown; options?: { compiler?: { version?: unknown } } };
  transform?: Hook | { handler: Hook; [key: string]: unknown };
  load?: LoadHook | { handler: LoadHook; [key: string]: unknown };
};
type Lane = { isClient?: boolean; isServer?: boolean };
type Nuxt = {
  hook: (
    name: "vite:configResolved",
    hook: (
      config: { plugins: CompilerPlugin[]; root?: string; cacheDir?: string },
      context: Lane,
    ) => void,
  ) => void;
};
export function nuxtUiCompilerAuthority(_options: unknown, nuxt: Nuxt): void {
  const directory = authorityDirectory();
  const current = phase();
  assert.ok(directory && current);
  const session = path.join(directory, current, `session-${process.pid}-${randomUUID()}`);
  let serial = 0;
  nuxt.hook("vite:configResolved", (config, context) => {
    const isNative = (plugin: CompilerPlugin) =>
      plugin.name === "vite-plugin-vize" ||
      plugin.name?.startsWith("vite-plugin-vize:") ||
      plugin.name?.startsWith("vize:");
    const owners = config.plugins.filter(
      (plugin) => plugin && (plugin.name === "vite:vue" || isNative(plugin)),
    );
    const stock = owners.filter((plugin) => plugin.name === "vite:vue");
    if (current === "reference") {
      assert.equal(stock.length, 1, "stock Nuxt must retain exactly one public vite:vue compiler");
      assert.equal(owners.length, 1, "reference refuses any native Vize compiler plugin");
    } else
      assert.ok(
        owners.some((plugin) => plugin.name === "vite-plugin-vize"),
        "candidate must use the native plugin",
      );
    write(session, `plugins-${serial++}.json`, {
      context,
      root: config.root,
      cacheDir: config.cacheDir,
      names: config.plugins.map((plugin) => plugin?.name),
      owners: owners.map((plugin) => ({
        name: plugin.name,
        version: plugin.api?.version,
        compilerVersion: plugin.api?.options?.compiler?.version,
      })),
    });
    for (const plugin of owners) {
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
