import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { fixtureIdentity } from "./nuxt-ui-fixture-identity.ts";
import { withViteNodeRequestBudget } from "../app/dev/nuxt-ui-vite-node.ts";

type Phase = "candidate" | "reference";
const CONFIG = "playgrounds/nuxt/nuxt.config.ts";
const COMPILER = "compiler: {\n      handleNodeModulesVue: false,\n    }";
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export function phase(): Phase | undefined {
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
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");
}

export function configureNuxtUiAuthority(configPath: string): void {
  if (!phase()) return;
  let config = withViteNodeRequestBudget(fs.readFileSync(configPath, "utf8"));
  const helper = fileURLToPath(new URL("./nuxt-ui-compiler-authority.ts", import.meta.url));
  assert.ok(config.includes(COMPILER), "candidate compiler configuration changed");
  assert.ok(config.includes("    '@nuxt/ui'\n  ],"), "pinned upstream module roster changed");
  config = `import { nuxtUiCompilerAuthority } from ${JSON.stringify(helper)};\n${config}`.replace(
    "    '@nuxt/ui'\n  ],",
    "    '@nuxt/ui',\n    nuxtUiCompilerAuthority,\n  ],",
  );
  const directory = authorityDirectory()!;
  fs.writeFileSync(path.join(directory, "candidate-config.ts"), config);
  fs.writeFileSync(
    configPath,
    phase() === "reference" ? stockNuxtUiCompilerConfig(config) : config,
  );
  write(authorityDirectory()!, "current-fixture.json", {
    cwd: path.resolve(path.dirname(configPath), "../.."),
  });
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

const PREPARE =
  "nuxt-module-build build --stub && nuxt-module-build prepare && nuxt prepare playgrounds/nuxt && nuxt prepare docs && pnpm dev:vue:build";
const BUILD = "pnpm --filter './playgrounds/vue' build";
// Upstream dev:prepare also builds a separate Vue playground. Its generated
// files become CSS scan inputs, so both selected Nuxt phases prepare only the
// authored module/Nuxt prerequisites and require that unrelated output to stay absent.
const COMMANDS = [
  ["nuxt-module-build", "build", "--stub"],
  ["nuxt-module-build", "prepare"],
  ["nuxt", "prepare", "playgrounds/nuxt"],
  ["nuxt", "prepare", "docs"],
] as const;

export function assertNuxtUiPlaygroundOutputAbsent(cwd: string): void {
  const root = fs.realpathSync(cwd);
  let cursor = root;
  for (const part of ["playgrounds", "vue", "dist"]) {
    cursor = path.join(cursor, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    assert.ok(
      !stat.isSymbolicLink(),
      "selected Nuxt preparation refuses an aliased Vue output path",
    );
    assert.notEqual(
      part,
      "dist",
      "selected Nuxt preparation must not create Vue playground production output",
    );
    assert.ok(stat.isDirectory());
    assert.ok(fs.realpathSync(cursor).startsWith(`${root}${path.sep}`));
  }
}

export function nuxtUiPreparationCommands(cwd: string): string[][] {
  const scripts = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).scripts;
  assert.equal(
    scripts["dev:prepare"],
    PREPARE,
    "exact pinned upstream preparation script required",
  );
  assert.equal(scripts["dev:vue:build"], BUILD, "exact unrelated Vue output producer required");
  const playground = JSON.parse(
    fs.readFileSync(path.join(cwd, "playgrounds/nuxt/package.json"), "utf8"),
  );
  assert.equal(playground.dependencies["@nuxt/ui"], "workspace:*");
  assert.equal(playground.dependencies["playground-vue"], undefined);
  return COMMANDS.map((args) => ["-y", "pnpm@10", "exec", ...args]);
}

function retainPreparedIdentity(cwd: string, current: Phase): void {
  const directory = authorityDirectory()!;
  assertNuxtUiPlaygroundOutputAbsent(cwd);
  const identity = fixtureIdentity(cwd);
  const baseline = path.join(directory, "prepared-world-identity.json");
  if (fs.existsSync(baseline))
    assert.deepEqual(
      identity,
      JSON.parse(fs.readFileSync(baseline, "utf8")),
      "same physical prepared source, lock and providers required",
    );
  else {
    assert.equal(current, "reference", "the independent stock reference must prepare first");
    write(directory, "prepared-world-identity.json", identity);
    fs.copyFileSync(
      path.join(cwd, "pnpm-lock.yaml"),
      path.join(directory, "provider-pnpm-lock.yaml"),
    );
    fs.copyFileSync(
      path.join(cwd, "package.json"),
      path.join(directory, "preparation-package.json"),
    );
    const reka = identity.providers.find((provider) => provider.name === "reka-ui");
    assert.ok(reka);
    const modules = reka.files.filter(
      (file) =>
        /(?:SelectRoot|SelectValue|Primitive|Slot)\.(?:[cm]?js|vue)(?:\.map)?$/.test(file.path) ||
        file.path === "package.json" ||
        file.path === "dist/index.js",
    );
    for (const name of ["SelectRoot", "SelectValue", "Primitive", "Slot"])
      assert.ok(
        modules.some((file) => path.basename(file.path).startsWith(`${name}.`)),
        `missing actual installed ${name}`,
      );
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
  const name = `${current}-prepared-identity.json`;
  if (fs.existsSync(path.join(directory, name)))
    assert.deepEqual(identity, JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
  else write(directory, name, identity);
}

type PrepareRunner = (command: string, args: string[], cwd: string) => void;
const execute: PrepareRunner = (command, args, cwd) => {
  execFileSync(command, args, { cwd, stdio: "inherit", timeout: 900_000 });
};

export function prepareNuxtUiSelectedApp(cwd: string, run: PrepareRunner = execute): boolean {
  const current = phase(),
    directory = authorityDirectory();
  if (!current || !directory) return false;
  if (!fs.existsSync(path.join(directory, "prepared-world-identity.json")))
    assert.equal(current, "reference", "the independent stock reference must prepare first");
  const commands = nuxtUiPreparationCommands(cwd);
  assertNuxtUiPlaygroundOutputAbsent(cwd);
  const receipt = {
    phase: current,
    pid: process.pid,
    scope: "selected-nuxt-app",
    excludedProducer: BUILD,
    commands: [] as unknown[],
  };
  const name = `preparation-${current}-${randomUUID()}.json`;
  for (const args of commands) {
    const command = { command: "npx", args, cwd, startedAt: new Date().toISOString() };
    receipt.commands.push(command);
    write(directory, name, receipt);
    try {
      run(command.command, args, cwd);
    } catch (error) {
      receipt.commands.push({
        failure: inspect(error, { depth: null, showHidden: true, customInspect: false }),
      });
      write(directory, name, receipt);
      throw error;
    }
    receipt.commands.push({ completedAt: new Date().toISOString() });
    write(directory, name, receipt);
    assertNuxtUiPlaygroundOutputAbsent(cwd);
  }
  retainPreparedIdentity(cwd, current);
  write(directory, "prepared-world-state.json", { phase: current });
  return true;
}

function previousServersStopped(directory: string, current: Phase, transition: boolean): void {
  const phaseDirectory = path.join(directory, current);
  const records = fs.existsSync(phaseDirectory)
    ? fs.readdirSync(phaseDirectory).filter((name) => /^server-\d+\.json$/.test(name))
    : [];
  if (transition) {
    assert.ok(records.length > 0, "actual previous server process identities required");
    const seal = JSON.parse(
      fs.readFileSync(path.join(directory, `${current}-server-stopped.json`), "utf8"),
    );
    assert.equal(seal.processGroupsAbsent, true);
    assert.equal(seal.portClosed, true);
    const sorted = (names: string[]) => [...names].sort((left, right) => left.localeCompare(right));
    assert.deepEqual(sorted(seal.records), sorted(records));
  }
  for (const name of records) {
    const record = JSON.parse(fs.readFileSync(path.join(phaseDirectory, name), "utf8"));
    assert.equal(record.phase, current);
    assert.equal(record.pid, record.detachedProcessGroup);
    assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1);
    try {
      process.kill(-record.pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      continue;
    }
    assert.fail(
      "previous owned server group must stop before preparing another worker or compiler",
    );
  }
}

function clearObservedCaches(cwd: string, directory: string, previous: Phase): string[] {
  const caches = new Set<string>();
  const parent = path.join(directory, previous);
  for (const session of fs.readdirSync(parent).filter((name) => name.startsWith("session-")))
    for (const name of fs
      .readdirSync(path.join(parent, session))
      .filter((name) => name.startsWith("plugins-"))) {
      const record = JSON.parse(fs.readFileSync(path.join(parent, session, name), "utf8"));
      assert.equal(typeof record.cacheDir, "string", "actual previous Vite cache path required");
      const cache = path.resolve(record.cacheDir);
      assert.ok(
        cache.split(path.sep).some((part) => [".nuxt", ".cache", ".vite", ".vize"].includes(part)),
      );
      caches.add(cache);
    }
  assert.ok(caches.size > 0, "observed previous compiler caches required");
  function collect(parent: string): void {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const file = path.join(parent, entry.name);
      if (entry.name === "node_modules")
        for (const name of [".vite", ".cache"]) caches.add(path.join(file, name));
      else if ([".nuxt", ".output", ".vize", ".cache", ".vite"].includes(entry.name))
        caches.add(file);
      else if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== ".git")
        collect(file);
    }
  }
  collect(cwd);
  return removeOwnedNuxtUiCaches(cwd, caches);
}

export function resumeNuxtUiPreparedApp(cwd: string, run: PrepareRunner = execute): boolean {
  const current = phase(),
    directory = authorityDirectory();
  if (!current || !directory || !fs.existsSync(path.join(directory, "prepared-world-state.json")))
    return false;
  const previous = JSON.parse(
    fs.readFileSync(path.join(directory, "prepared-world-state.json"), "utf8"),
  ).phase as Phase;
  assert.ok(previous === "candidate" || previous === "reference");
  assertNuxtUiPlaygroundOutputAbsent(cwd);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(directory, "prepared-world-identity.json"), "utf8"),
  );
  assert.deepEqual(
    fixtureIdentity(cwd),
    baseline,
    "same physical prepared source, lock and providers required",
  );
  const candidate = fs.readFileSync(path.join(directory, "candidate-config.ts"), "utf8");
  const config = (value: Phase) =>
    value === "reference" ? stockNuxtUiCompilerConfig(candidate) : candidate;
  const configPath = path.join(cwd, CONFIG);
  assert.equal(
    fs.readFileSync(configPath, "utf8"),
    config(previous),
    "exact previous compiler configuration required",
  );
  previousServersStopped(directory, previous, previous !== current);
  if (previous === current) return true;
  const removed = clearObservedCaches(cwd, directory, previous);
  assert.deepEqual(
    fixtureIdentity(cwd),
    baseline,
    "cache removal must preserve prepared input identity",
  );
  fs.writeFileSync(configPath, config(current));
  write(directory, `${previous}-to-${current}-transition.json`, {
    previous,
    current,
    removed,
    configBeforeSha256: sha256(config(previous)),
    configAfterSha256: sha256(config(current)),
  });
  prepareNuxtUiSelectedApp(cwd, run);
  return true;
}

export function sealNuxtUiPhase(cwd: string): ReturnType<typeof fixtureIdentity> {
  const current = phase(),
    directory = authorityDirectory();
  assert.ok(current && directory);
  retainPreparedIdentity(cwd, current);
  const identity = fixtureIdentity(cwd);
  write(directory, `${current}-identity.json`, identity);
  const candidate = fs.readFileSync(path.join(directory, "candidate-config.ts"), "utf8");
  assert.equal(
    fs.readFileSync(path.join(cwd, CONFIG), "utf8"),
    current === "reference" ? stockNuxtUiCompilerConfig(candidate) : candidate,
  );
  fs.writeFileSync(
    path.join(directory, `${current}-config.ts`),
    fs.readFileSync(path.join(cwd, CONFIG)),
  );
  return identity;
}
