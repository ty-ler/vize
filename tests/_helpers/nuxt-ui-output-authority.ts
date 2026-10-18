import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
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
  hooks.onServer((server, lane) => {
    servers.push({ server, lane });
  });
  // Registered by the authored module before Nuxt creates Vite servers and
  // registers their close hooks. No timer, request or graph mutation is added.
  hooks.onClose(() => {
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
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "module-graphs.json"),
      `${JSON.stringify({ schema: 1, graphs }, null, 2)}\n`,
    );
  });
}

export function verifyNuxtUiGeneratedOutputUnused(directory: string, cwd: string) {
  const select = path.join(cwd, "src/runtime/components/Select.vue").replaceAll(path.sep, "/");
  const phases = (["candidate", "reference"] as const).map((phase) => {
    const phaseDirectory = path.join(directory, phase);
    const records = fs
      .readdirSync(phaseDirectory)
      .filter((name) => name.startsWith("session-"))
      .flatMap((session) => {
        const file = path.join(phaseDirectory, session, "module-graphs.json");
        if (!fs.existsSync(file)) return [];
        const record = JSON.parse(fs.readFileSync(file, "utf8")) as {
          schema: number;
          graphs: { lane: Lane; environment: string | null }[];
        };
        assert.equal(record.schema, 1);
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
