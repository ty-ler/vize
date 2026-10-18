import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNuxtUiPlaygroundOutputAbsent,
  configureNuxtUiAuthority,
  nuxtUiPreparationCommands,
  prepareNuxtUiSelectedApp,
  resumeNuxtUiPreparedApp,
  sealNuxtUiPhase,
  stockNuxtUiCompilerConfig,
} from "../_helpers/nuxt-ui-prepared-world.ts";

const PREPARE =
  "nuxt-module-build build --stub && nuxt-module-build prepare && nuxt prepare playgrounds/nuxt && nuxt prepare docs && pnpm dev:vue:build";
const BUILD = "pnpm --filter './playgrounds/vue' build";
const CONFIG = "playgrounds/nuxt/nuxt.config.ts";
const ORIGINAL =
  "export default {\n  modules: [\n    '@nuxt/ui'\n  ],\n  vize: { compiler: {\n      handleNodeModulesVue: false,\n    } },\n};\n";
const PACKAGES = [
  "nuxt",
  "@nuxt/vite-builder",
  "@vitejs/plugin-vue",
  "vue",
  "@vue/compiler-sfc",
  "@vue/server-renderer",
  "reka-ui",
];

function write(root: string, file: string, value: string | object) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuxt-prepared-world-"));
  const cwd = path.join(root, "fixture"),
    authority = path.join(root, "authority");
  const oldPhase = process.env.VIZE_NUXT_UI_COMPILER_PHASE;
  const oldAuthority = process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY;
  process.env.VIZE_NUXT_UI_COMPILER_PHASE = "reference";
  process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY = authority;
  write(cwd, "package.json", {
    name: "@nuxt/ui",
    scripts: { "dev:prepare": PREPARE, "dev:vue:build": BUILD },
  });
  write(cwd, "playgrounds/nuxt/package.json", { dependencies: { "@nuxt/ui": "workspace:*" } });
  write(cwd, CONFIG, ORIGINAL);
  write(cwd, "pnpm-lock.yaml", "whole pinned lock\n");
  write(cwd, ".vize-fixture-source.json", { commit: "3dbca020969582d577c7df9698dc8cd484f76dc1" });
  write(
    cwd,
    "src/runtime/components/Select.vue",
    "<template><button>whole source</button></template>\n",
  );
  for (const name of PACKAGES)
    write(cwd, `node_modules/${name}/package.json`, { name, version: "1.0.0" });
  for (const name of ["SelectRoot", "SelectValue", "Primitive", "Slot"])
    write(
      cwd,
      `node_modules/reka-ui/dist/${name}.js`,
      `export const ${name} = ${JSON.stringify(name)};\n`,
    );
  configureNuxtUiAuthority(path.join(cwd, CONFIG));
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const run = (command: string, args: string[], directory: string) => {
    calls.push({ command, args, cwd: directory });
  };
  const json = (file: string) => JSON.parse(fs.readFileSync(path.join(authority, file), "utf8"));
  function stopped(current: "candidate" | "reference") {
    const file = "server-99999999.json";
    write(authority, `${current}/${file}`, {
      phase: current,
      pid: 99999999,
      detachedProcessGroup: 99999999,
    });
    write(authority, `${current}-server-stopped.json`, {
      records: [file],
      processGroupsAbsent: true,
      portClosed: true,
    });
    write(cwd, "playgrounds/nuxt/.nuxt/cache.bin", "old compiler cache");
    write(authority, `${current}/session-fixture/plugins-0.json`, {
      cacheDir: path.join(cwd, "playgrounds/nuxt/.nuxt"),
    });
  }
  function cleanup() {
    if (oldPhase === undefined) delete process.env.VIZE_NUXT_UI_COMPILER_PHASE;
    else process.env.VIZE_NUXT_UI_COMPILER_PHASE = oldPhase;
    if (oldAuthority === undefined) delete process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY;
    else process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY = oldAuthority;
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { root, cwd, authority, calls, run, json, stopped, cleanup };
}

test("selected Nuxt preparation uses four exact authored commands and refuses upstream drift", () => {
  const f = fixture();
  try {
    assert.deepEqual(nuxtUiPreparationCommands(f.cwd), [
      ["-y", "pnpm@10", "exec", "nuxt-module-build", "build", "--stub"],
      ["-y", "pnpm@10", "exec", "nuxt-module-build", "prepare"],
      ["-y", "pnpm@10", "exec", "nuxt", "prepare", "playgrounds/nuxt"],
      ["-y", "pnpm@10", "exec", "nuxt", "prepare", "docs"],
    ]);
    write(f.cwd, "package.json", {
      scripts: { "dev:prepare": PREPARE + " && unrelated build", "dev:vue:build": BUILD },
    });
    assert.throws(() => prepareNuxtUiSelectedApp(f.cwd, f.run), /exact pinned upstream/);
    assert.deepEqual(f.calls, []);
  } finally {
    f.cleanup();
  }
});

test("ordinary setup keeps its original preparation path without paired side effects", () => {
  const f = fixture();
  try {
    delete process.env.VIZE_NUXT_UI_COMPILER_PHASE;
    assert.equal(prepareNuxtUiSelectedApp(f.cwd, f.run), false);
    assert.equal(resumeNuxtUiPreparedApp(f.cwd, f.run), false);
    assert.deepEqual(f.calls, []);
    assert.equal(fs.existsSync(path.join(f.authority, "prepared-world-state.json")), false);
  } finally {
    f.cleanup();
  }
});

test("prepared stock seals physical inputs before any server and swaps both directions with the same commands", () => {
  const f = fixture();
  try {
    assert.equal(prepareNuxtUiSelectedApp(f.cwd, f.run), true);
    assert.equal(f.calls.length, 4);
    const initial = f.json("prepared-world-identity.json");
    assert.deepEqual(f.json("reference-prepared-identity.json"), initial);
    assert.equal(
      fs.readFileSync(path.join(f.authority, "provider-pnpm-lock.yaml"), "utf8"),
      "whole pinned lock\n",
    );
    assert.equal(
      fs.readFileSync(path.join(f.authority, "provider-reka-ui/dist/Slot.js"), "utf8"),
      'export const Slot = "Slot";\n',
    );
    const candidate = fs.readFileSync(path.join(f.authority, "candidate-config.ts"), "utf8");
    assert.equal(
      fs.readFileSync(path.join(f.cwd, CONFIG), "utf8"),
      stockNuxtUiCompilerConfig(candidate),
    );
    sealNuxtUiPhase(f.cwd);
    f.stopped("reference");
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "candidate";
    assert.equal(resumeNuxtUiPreparedApp(f.cwd, f.run), true);
    assert.equal(f.calls.length, 8);
    assert.deepEqual(f.calls.slice(4), f.calls.slice(0, 4));
    assert.deepEqual(f.json("candidate-prepared-identity.json"), initial);
    assert.equal(fs.readFileSync(path.join(f.cwd, CONFIG), "utf8"), candidate);
    assert.equal(fs.existsSync(path.join(f.cwd, "playgrounds/nuxt/.nuxt/cache.bin")), false);
    sealNuxtUiPhase(f.cwd);
    f.stopped("candidate");
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "reference";
    assert.equal(resumeNuxtUiPreparedApp(f.cwd, f.run), true);
    assert.deepEqual(f.calls.slice(8), f.calls.slice(0, 4));
    assert.deepEqual(sealNuxtUiPhase(f.cwd), initial);
    assertNuxtUiPlaygroundOutputAbsent(f.cwd);
  } finally {
    f.cleanup();
  }
});

test("candidate retries reuse the sealed prepared world while refusing source, provider, lock and config mutation", () => {
  for (const mutation of [
    "src/runtime/components/Select.vue",
    "node_modules/vue/package.json",
    "pnpm-lock.yaml",
    CONFIG,
  ]) {
    const f = fixture();
    try {
      prepareNuxtUiSelectedApp(f.cwd, f.run);
      f.stopped("reference");
      process.env.VIZE_NUXT_UI_COMPILER_PHASE = "candidate";
      resumeNuxtUiPreparedApp(f.cwd, f.run);
      const before = f.calls.length;
      assert.equal(resumeNuxtUiPreparedApp(f.cwd, f.run), true);
      assert.equal(f.calls.length, before);
      fs.appendFileSync(path.join(f.cwd, mutation), " \n");
      assert.throws(
        () => resumeNuxtUiPreparedApp(f.cwd, f.run),
        /source, lock and providers|configuration/,
      );
      assert.equal(f.calls.length, before);
    } finally {
      f.cleanup();
    }
  }
});

test("Vue playground output or an alias is refused without deleting even one existing byte", () => {
  const f = fixture();
  try {
    write(f.cwd, "playgrounds/vue/dist/keep.js", "do not delete");
    assert.throws(() => prepareNuxtUiSelectedApp(f.cwd, f.run), /must not create Vue playground/);
    assert.deepEqual(f.calls, []);
    assert.equal(
      fs.readFileSync(path.join(f.cwd, "playgrounds/vue/dist/keep.js"), "utf8"),
      "do not delete",
    );
    fs.rmSync(path.join(f.cwd, "playgrounds/vue/dist"), { recursive: true });
    fs.symlinkSync(path.join(f.root, "missing-foreign"), path.join(f.cwd, "playgrounds/vue/dist"));
    assert.throws(() => assertNuxtUiPlaygroundOutputAbsent(f.cwd), /aliased/);
  } finally {
    f.cleanup();
  }
});

test("new output and actual preparation errors refuse before a prepared-world seal", () => {
  const f = fixture();
  try {
    const failure = Object.assign(new Error("whole original preparation failure"), {
      code: "EEXEC",
    });
    assert.throws(
      () =>
        prepareNuxtUiSelectedApp(f.cwd, () => {
          throw failure;
        }),
      (error) => error === failure,
    );
    assert.equal(fs.existsSync(path.join(f.authority, "prepared-world-identity.json")), false);
    assert.throws(
      () =>
        prepareNuxtUiSelectedApp(f.cwd, () => {
          write(f.cwd, "playgrounds/vue/dist/new.js", "unexpected producer");
        }),
      /must not create/,
    );
    assert.equal(
      fs.readFileSync(path.join(f.cwd, "playgrounds/vue/dist/new.js"), "utf8"),
      "unexpected producer",
    );
    assert.equal(fs.existsSync(path.join(f.authority, "prepared-world-state.json")), false);
    const receipts = fs
      .readdirSync(f.authority)
      .filter((name) => name.startsWith("preparation-reference-"));
    assert.equal(
      receipts.length,
      2,
      "both failed preparation attempts retain separate whole receipts",
    );
    const packets = receipts.map((name) => fs.readFileSync(path.join(f.authority, name), "utf8"));
    assert.ok(
      packets.some(
        (packet) =>
          packet.includes("whole original preparation failure") && packet.includes("EEXEC"),
      ),
    );
    assert.ok(packets.every((packet) => JSON.parse(packet).pid === process.pid));
  } finally {
    f.cleanup();
  }
});

test("compiler transition refuses a missing stop seal and a genuine live owned process group", async () => {
  const f = fixture();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  try {
    assert.ok(child.pid);
    prepareNuxtUiSelectedApp(f.cwd, f.run);
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "candidate";
    assert.throws(
      () => resumeNuxtUiPreparedApp(f.cwd, f.run),
      /previous server process identities/,
    );
    const name = `server-${child.pid}.json`;
    write(f.authority, `reference/${name}`, {
      phase: "reference",
      pid: child.pid,
      detachedProcessGroup: child.pid,
    });
    assert.throws(() => resumeNuxtUiPreparedApp(f.cwd, f.run), /ENOENT/);
    write(f.authority, "reference-server-stopped.json", {
      records: [name],
      processGroupsAbsent: true,
      portClosed: true,
    });
    assert.throws(() => resumeNuxtUiPreparedApp(f.cwd, f.run), /previous owned server group/);
    assert.equal(f.calls.length, 4);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    f.cleanup();
  }
});

test("an unprepared native phase refuses before executing even one preparation command", () => {
  const f = fixture();
  try {
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "candidate";
    assert.throws(
      () => prepareNuxtUiSelectedApp(f.cwd, f.run),
      /stock reference must prepare first/,
    );
    assert.deepEqual(f.calls, []);
    assert.equal(fs.existsSync(path.join(f.authority, "prepared-world-identity.json")), false);
  } finally {
    f.cleanup();
  }
});
