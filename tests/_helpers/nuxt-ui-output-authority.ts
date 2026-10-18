import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";
import { fixtureIdentity } from "./nuxt-ui-fixture-identity.ts";

type Identity = ReturnType<typeof fixtureIdentity>;
const OUTPUT = "playgrounds/vue/dist";
const PREPARE =
  "nuxt-module-build build --stub && nuxt-module-build prepare && nuxt prepare playgrounds/nuxt && nuxt prepare docs && pnpm dev:vue:build";
const BUILD = "pnpm --filter './playgrounds/vue' build";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const isVuePlaygroundOutput = (file: string) => file.startsWith(`${OUTPUT}/`);

export function retainNuxtUiGeneratedOutput(cwd: string, directory: string, identity: Identity) {
  const root = fs.realpathSync(cwd);
  const manifest = fs.readFileSync(path.join(root, "package.json"));
  const scripts = JSON.parse(manifest.toString("utf8")).scripts;
  assert.equal(scripts["dev:prepare"], PREPARE, "exact authored prepare command required");
  assert.equal(scripts["dev:vue:build"], BUILD, "exact authored output producer required");
  const files = identity.source.filter((file) => isVuePlaygroundOutput(file.path));
  assert.ok(files.length > 0, "actual generated output inventory is mandatory");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "producer-package.json"), manifest);
  for (const file of files) {
    assert.equal(file.symlink, undefined, "generated output must be ordinary owned bytes");
    let cursor = root;
    for (const part of file.path.split(path.sep)) {
      cursor = path.join(cursor, part);
      assert.equal(
        fs.lstatSync(cursor).isSymbolicLink(),
        false,
        "output ancestors cannot alias foreign bytes",
      );
    }
    const bytes = fs.readFileSync(cursor);
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256);
    const target = path.join(directory, "bodies", file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  const result = {
    schema: 1,
    namespace: OUTPUT,
    producer: {
      packageSha256: sha256(manifest),
      prepare: PREPARE,
      build: BUILD,
    },
    files,
  };
  fs.writeFileSync(path.join(directory, "inventory.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function compareNuxtUiAuthoredIdentity(before: Identity, after: Identity) {
  // The complete original source manifests remain retained. This partition is
  // admitted only after both actual compiler graphs prove output non-use.
  const authored = (identity: Identity) => ({
    ...identity,
    source: identity.source.filter((file) => !isVuePlaygroundOutput(file.path)),
  });
  assert.deepEqual(
    authored(after),
    authored(before),
    "same physical authored source, lock and all provider bytes",
  );
  const old = new Map(
    before.source
      .filter((file) => isVuePlaygroundOutput(file.path))
      .map((file) => [file.path, file]),
  );
  const next = new Map(
    after.source
      .filter((file) => isVuePlaygroundOutput(file.path))
      .map((file) => [file.path, file]),
  );
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((name) => {
    const previous = old.get(name) ?? null;
    const current = next.get(name) ?? null;
    return JSON.stringify(previous) === JSON.stringify(current)
      ? []
      : [{ path: name, before: previous, after: current }];
  });
}

type Module = {
  id: string | null;
  url: string;
  file: string | null;
  type?: string;
  importedModules: Set<Module>;
  importers: Set<Module>;
};
type Graph = { idToModuleMap: Map<string, Module> };
type Server = { moduleGraph: Graph; environments?: Record<string, { moduleGraph: Graph }> };
export type AliveViteServer = Server & {
  config: { base: string };
  middlewares: {
    use(
      callback: (
        request: { url?: string },
        response: {
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(body: string): void;
        },
        next: () => void,
      ) => void,
    ): void;
  };
};
export const NUXT_UI_GRAPH_PATH = "__vize_nuxt_ui_module_graphs__";
export type Lane = { isClient?: boolean; isServer?: boolean };
export type ModuleGraphHooks = {
  "vite:serverCreated": (server: Server, lane: Lane) => void;
  close: () => void;
};

export function snapshotNuxtUiModuleGraph(graph: Graph) {
  assert.ok(graph.idToModuleMap instanceof Map, "actual Vite module map required");
  const modules: Module[] = [];
  const indexes = new Map<Module, number>();
  function include(module: Module) {
    if (!indexes.has(module)) {
      indexes.set(module, modules.length);
      modules.push(module);
    }
  }
  for (const module of graph.idToModuleMap.values()) include(module);
  for (const module of modules) {
    assert.ok(module.importedModules instanceof Set && module.importers instanceof Set);
    for (const related of [...module.importedModules, ...module.importers]) include(related);
  }
  return {
    entries: [...graph.idToModuleMap].map(([id, module]) => ({
      id,
      module: indexes.get(module) ?? -1,
    })),
    modules: modules.map((module) => ({
      id: module.id,
      url: module.url,
      file: module.file,
      type: module.type ?? null,
      realFile: module.file && fs.existsSync(module.file) ? fs.realpathSync(module.file) : null,
      importedModules: [...module.importedModules].map((value) => indexes.get(value) ?? -1),
      importers: [...module.importers].map((value) => indexes.get(value) ?? -1),
    })),
  };
}

export function observeNuxtUiModuleGraphs(
  hooks: {
    onServer(callback: ModuleGraphHooks["vite:serverCreated"]): void;
    onClose(callback: ModuleGraphHooks["close"]): void;
  },
  directory: string,
) {
  const servers: { server: Server; lane: Lane }[] = [];
  const include = (server: Server, lane: Lane) => {
    if (!servers.some((record) => record.server === server)) servers.push({ server, lane });
  };
  hooks.onServer(include);
  // Registered by the authored module before Nuxt creates Vite servers and
  // registers their close hooks. Close records remain diagnostics only; live
  // admission uses an explicit test request before the owned server is killed.
  const snapshot = () => {
    const graphs = servers.flatMap(({ server, lane }, index) => {
      const environments = server.environments;
      return (
        environments
          ? Object.entries(environments).map(([environment, value]) => ({
              environment,
              graph: value.moduleGraph,
            }))
          : [{ environment: null, graph: server.moduleGraph }]
      ).map(({ environment, graph }) => ({
        server: index,
        lane,
        environment,
        ...snapshotNuxtUiModuleGraph(graph),
      }));
    });
    return { schema: 1, graphs };
  };
  hooks.onClose(() => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "module-graphs.json"), JSON.stringify(snapshot()));
  });
  const registered = new WeakSet<AliveViteServer>();
  return (server: AliveViteServer, lane: Lane) => {
    include(server, lane);
    if (!(lane.isClient === true || lane.isServer === false)) return;
    if (registered.has(server)) return;
    registered.add(server);
    assert.ok(
      server.config.base.startsWith("/") && server.config.base.endsWith("/"),
      "actual Vite public base is required",
    );
    const route = new URL(NUXT_UI_GRAPH_PATH, `http://localhost${server.config.base}`).pathname;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "graph-endpoint.json"),
      JSON.stringify({
        route,
        pid: process.pid,
        session: path.basename(directory),
      }),
    );
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split("?")[0];
      if (pathname !== route && pathname !== `/${NUXT_UI_GRAPH_PATH}`) return next();
      response.setHeader("Content-Type", "application/json");
      try {
        const record = {
          ...snapshot(),
          live: true,
          pid: process.pid,
          phase: path.basename(path.dirname(directory)),
          session: path.basename(directory),
        };
        assert.ok(record.graphs.length > 0, "live Vite graph inventory must be nonempty");
        const body = JSON.stringify(record);
        fs.writeFileSync(path.join(directory, "module-graphs-live.json"), body);
        response.statusCode = 200;
        response.end(body);
      } catch (error) {
        const failure =
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
                ...Object.fromEntries(Object.entries(error)),
                cause: inspect(error.cause, { depth: null, customInspect: false }),
                raw: inspect(error, { depth: null, showHidden: true, customInspect: false }),
              }
            : { type: typeof error, raw: inspect(error, { depth: null, customInspect: false }) };
        const body = JSON.stringify({ schema: 1, live: false, failure });
        fs.writeFileSync(path.join(directory, "module-graphs-live-error.json"), body);
        response.statusCode = 500;
        response.end(body);
      }
    });
  };
}

export function verifyNuxtUiGeneratedOutputUnused(directory: string, cwd: string) {
  const select = path.join(cwd, "src/runtime/components/Select.vue").replaceAll(path.sep, "/");
  const phases = (["candidate", "reference"] as const).map((phase) => {
    const phaseDirectory = path.join(directory, phase);
    const records = fs
      .readdirSync(phaseDirectory)
      .filter((name) => name.startsWith("session-"))
      .flatMap((session) => {
        const file = path.join(phaseDirectory, session, "module-graphs-live.json");
        if (!fs.existsSync(file)) return [];
        const record = JSON.parse(fs.readFileSync(file, "utf8")) as {
          schema: number;
          live: boolean;
          pid: number;
          graphs: { lane: Lane; environment: string | null }[];
        };
        assert.equal(record.schema, 1);
        assert.equal(record.live, true, "actual live capture required");
        assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0);
        return record.graphs.map((graph) => ({ file, ...graph })) as ({
          file: string;
          lane: Lane;
          environment: string | null;
        } & ReturnType<typeof snapshotNuxtUiModuleGraph>)[];
      });
    const selected = records.filter((record) =>
      record.modules.some((module) =>
        [module.id, module.file, module.realFile].some((id) => {
          if (id === null) return false;
          const pathname = id
            .split("?")[0]!
            .replaceAll("\\", "/")
            .replace(/^\0vize(?:-ssr)?:/, "")
            .replace(/^\/@fs/, "")
            .replace(/(\.vue)\.tsx?$/, "$1");
          return pathname === select;
        }),
      ),
    );
    for (const server of [false, true])
      assert.ok(
        selected.some(
          (record) =>
            (record.environment
              ? ["ssr", "server"].includes(record.environment)
              : Boolean(record.lane.isServer)) === server,
        ),
        `${phase} requires nonempty actual Select module graphs in both lanes`,
      );
    for (const record of records) {
      const references = [
        ...record.entries.map((entry) => entry.id),
        ...record.modules.flatMap((module) => [
          module.id,
          module.url,
          module.file,
          module.realFile,
        ]),
      ];
      for (const value of references) {
        if (value === null) continue;
        assert.equal(typeof value, "string", "module graph preserves exact provider identifiers");
        const decoded = path.posix.normalize(
          decodeURIComponent(value).replaceAll("\\", "/").split("?")[0]!,
        );
        assert.equal(
          /(?:^|\/)playgrounds\/vue\/dist(?:\/|$|\?)/.test(decoded),
          false,
          "selected Nuxt module graph uses generated Vue playground output",
        );
      }
      for (const entry of record.entries)
        assert.ok(Number.isInteger(entry.module) && record.modules[entry.module]);
      for (const module of record.modules)
        for (const index of [...module.importedModules, ...module.importers])
          assert.ok(
            Number.isInteger(index) && record.modules[index],
            "complete module graph edge closure",
          );
    }
    return {
      phase,
      records: records.map((record) => ({
        file: record.file,
        environment: record.environment,
        lane: record.lane,
        modules: record.modules.length,
        entries: record.entries.length,
      })),
      actualSelectGraphs: selected.length,
      generatedNamespaceUsed: false,
    };
  });
  return { schema: 1, namespace: "playgrounds/vue/dist", phases };
}

export function summarizeNuxtUiWholeHtml(directory: string) {
  const routes = (["home", "button"] as const).map((name) => {
    const bodies = new Map<string, Buffer>();
    const phases = (["candidate", "reference"] as const).map((phase) => {
      const parent = path.join(directory, phase);
      const files = fs
        .readdirSync(parent)
        .filter((file) => file.startsWith(`html-${name}-`))
        .map((file) => {
          const target = path.join(parent, file, "normalized.html");
          const bytes = fs.readFileSync(target);
          assert.ok(bytes.length > 0, `${phase}/${name}: complete SSR body required`);
          bodies.set(target, bytes);
          return { file: target, bytes: bytes.length, sha256: sha256(bytes) };
        });
      assert.ok(
        files.length > 0,
        `${phase} must retain the complete original ${name} SSR response`,
      );
      if (phase === "reference")
        assert.equal(files.length, 1, `${name}: one stock observation, no retries`);
      return { phase, files };
    });
    const reference = phases.find((phase) => phase.phase === "reference");
    const first = reference?.files[0];
    assert.ok(first);
    const primary = bodies.get(first.file);
    assert.ok(primary);
    const wholeHtmlEqual = phases.every((phase) =>
      phase.files.every((file) => bodies.get(file.file)?.equals(primary)),
    );
    return { name, phases, wholeHtmlEqual };
  });
  return { routes, wholeHtmlEqual: routes.every((route) => route.wholeHtmlEqual) };
}

export async function captureNuxtUiAliveGraphResponse(
  directory: string,
  current: "candidate" | "reference",
  origin: string,
  request: (url: string) => Promise<{ status(): number; text(): Promise<string> }>,
): Promise<void> {
  const parent = path.join(directory, current);
  const routes = new Set(
    fs
      .readdirSync(parent)
      .filter((name) => name.startsWith("session-"))
      .flatMap((session) => {
        const file = path.join(parent, session, "graph-endpoint.json");
        return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, "utf8")).route] : [];
      }),
  );
  assert.equal(routes.size, 1, "actual dev Vite endpoint must be unambiguous");
  const route = [...routes][0];
  assert.ok(typeof route === "string" && route.startsWith("/") && !route.startsWith("//"));
  const target = new URL(route, origin);
  assert.equal(target.origin, new URL(origin).origin);
  const response = await request(target.href);
  const body = await response.text();
  fs.writeFileSync(path.join(parent, `graph-response-${randomUUID()}.json`), body);
  assert.equal(response.status(), 200, "actual dev Vite graph request failed");
  const captured = JSON.parse(body);
  assert.equal(captured.schema, 1);
  assert.equal(captured.live, true);
  assert.equal(captured.phase, current);
  assert.ok(Number.isSafeInteger(captured.pid) && captured.pid > 0);
  assert.match(captured.session, /^session-[0-9]+-[a-f0-9-]+$/);
  assert.equal(captured.session.split("-")[1], String(captured.pid));
  assert.equal(
    fs.readFileSync(path.join(parent, captured.session, "module-graphs-live.json"), "utf8"),
    body,
  );
  assert.ok(captured.graphs.length > 0, "actual live graph inventory required");
}
