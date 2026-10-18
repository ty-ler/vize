import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  authorityDirectory,
  configureNuxtUiAuthority,
  nuxtUiCompilerAuthority,
  removeOwnedNuxtUiCaches,
  stockNuxtUiCompilerConfig,
  summarizeNuxtUiTransforms,
  type CompilerPlugin,
  type CompilerPluginOption,
} from "../_helpers/nuxt-ui-compiler-authority.ts";

import { sourceInventory } from "../_helpers/nuxt-ui-fixture-identity.ts";

async function observe(plugins: CompilerPluginOption[], isServer: boolean) {
  let pending: void | Promise<void>;
  const config = { plugins };
  nuxtUiCompilerAuthority(undefined, {
    hook(_name, hook) {
      pending = hook(config, { isServer });
    },
  });
  await pending!;
  assert.equal(config.plugins, plugins, "observer must not replace the original PluginOption tree");
}

function temporary(run: (directory: string) => void | Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nuxt-ui-reference-law-"));
  const previous = {
    phase: process.env.VIZE_NUXT_UI_COMPILER_PHASE,
    authority: process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY,
  };
  process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY = directory;
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => {
      for (const [key, value] of [
        ["VIZE_NUXT_UI_COMPILER_PHASE", previous.phase],
        ["VIZE_NUXT_UI_COMPILER_AUTHORITY", previous.authority],
      ]) {
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      }
      fs.rmSync(directory, { recursive: true });
    });
}

test("nested Nuxt PluginOption arrays retain exact owners, handler objects and input tree", () =>
  temporary(async (directory) => {
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "candidate";
    const result = { code: "whole original native output", map: { mappings: "AAAA" } };
    const main: CompilerPlugin = { name: "vite-plugin-vize", transform: () => result };
    const nested = [{ name: "vite:vue" }, main, { name: "vize:post-transform" }];
    const promised = Promise.resolve<CompilerPluginOption[]>([false, [nested]]);
    const options: CompilerPluginOption[] = [undefined, false, promised, null];
    await observe(options, false);
    assert.equal(options[2], promised);
    assert.deepEqual(await promised, [false, [nested]]);
    const transform = main.transform;
    assert.ok(typeof transform === "function");
    assert.equal(
      await transform.call(
        {},
        "whole authored input",
        "/fixture/src/runtime/components/Select.vue",
        { ssr: false },
      ),
      result,
    );
    const candidate = path.join(directory, "candidate");
    const session = fs.readdirSync(candidate).find((name) => name.startsWith("session-"))!;
    const files = fs.readdirSync(path.join(candidate, session));
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(
          candidate,
          session,
          files.find((name) => name.startsWith("plugins-"))!,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(receipt.names, ["vite:vue", "vite-plugin-vize", "vize:post-transform"]);
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "reference";
    await assert.rejects(
      observe([[Promise.resolve([main])], { name: "vite:vue" }], false),
      /native Vize/,
    );
    await assert.rejects(
      observe([[{ name: "vite:vue" }], Promise.resolve([{ name: "vite:vue" }])], false),
      /exactly one/,
    );
  }));

test("owned stub symlinks retain literal targets and the complete target source inventory", () =>
  temporary((directory) => {
    fs.mkdirSync(path.join(directory, "src", "runtime"), { recursive: true });
    fs.mkdirSync(path.join(directory, "dist"));
    const body = Buffer.from("完整 Select source\n");
    fs.writeFileSync(path.join(directory, "src", "runtime", "Select.vue"), body);
    fs.symlinkSync("../src/runtime", path.join(directory, "dist", "runtime"), "dir");
    const entries = sourceInventory(directory, new Set());
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    assert.deepEqual(entries, [
      {
        path: "dist/runtime",
        bytes: 14,
        sha256: sha(Buffer.from("../src/runtime")),
        symlink: {
          targetBase64: Buffer.from("../src/runtime").toString("base64"),
          realTarget: path.join(fs.realpathSync(directory), "src", "runtime"),
          kind: "directory",
        },
      },
      { path: "src/runtime/Select.vue", bytes: body.length, sha256: sha(body) },
    ]);
    assert.equal(fs.readlinkSync(path.join(directory, "dist", "runtime")), "../src/runtime");
    assert.deepEqual(fs.readFileSync(path.join(directory, "src", "runtime", "Select.vue")), body);
  }));

test("inventory refuses external, broken and excluded-target links without following or modifying them", () =>
  temporary((directory) => {
    const owned = path.join(directory, "owned");
    const foreign = path.join(directory, "foreign");
    fs.mkdirSync(owned);
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, "keep"), "foreign exact bytes");
    const link = path.join(owned, "runtime");
    fs.symlinkSync(foreign, link, "dir");
    assert.throws(() => sourceInventory(owned, new Set()), /unowned symlink/);
    fs.unlinkSync(link);
    fs.symlinkSync("missing", link);
    assert.throws(() => sourceInventory(owned, new Set()), { code: "ENOENT" });
    fs.unlinkSync(link);
    fs.mkdirSync(path.join(owned, "excluded"));
    fs.writeFileSync(path.join(owned, "excluded", "keep"), "not enrolled");
    fs.symlinkSync("excluded", link, "dir");
    assert.throws(() => sourceInventory(owned, new Set(["excluded"])), /outside the inventory/);
    assert.equal(fs.readFileSync(path.join(foreign, "keep"), "utf8"), "foreign exact bytes");
    assert.equal(fs.readFileSync(path.join(owned, "excluded", "keep"), "utf8"), "not enrolled");
  }));

test("stock configuration changes only the one public compiler option", () => {
  const before =
    "// 原始 source\nmodules: ['@vizejs/nuxt', '@nuxt/ui'],\nvize: { musea: false, compiler: {\n      handleNodeModulesVue: false,\n    } },\nvite: { server: { hmr: true } }\n";
  assert.equal(
    stockNuxtUiCompilerConfig(before),
    "// 原始 source\nmodules: ['@vizejs/nuxt', '@nuxt/ui'],\nvize: { musea: false, compiler: false },\nvite: { server: { hmr: true } }\n",
  );
  assert.throws(() => stockNuxtUiCompilerConfig(before + before), /exactly one/);
  assert.throws(() => stockNuxtUiCompilerConfig("compiler: false"), /exactly one/);
});

test("cache removal refuses real parent and leaf symlink escapes before any deletion", () =>
  temporary((directory) => {
    const owned = path.join(directory, "fixture");
    const foreign = path.join(directory, "foreign");
    fs.mkdirSync(path.join(owned, ".nuxt"), { recursive: true });
    fs.mkdirSync(path.join(foreign, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(owned, ".nuxt", "keep"), "owned cache stays on refusal");
    fs.writeFileSync(path.join(foreign, ".cache", "keep"), "foreign provider exact bytes");
    fs.symlinkSync(foreign, path.join(owned, "node_modules"), "dir");
    assert.throws(
      () =>
        removeOwnedNuxtUiCaches(owned, [
          path.join(owned, ".nuxt"),
          path.join(owned, "node_modules", ".cache"),
        ]),
      /symlink/,
    );
    fs.symlinkSync(foreign, path.join(owned, ".nuxt", "parent"), "dir");
    assert.throws(
      () => removeOwnedNuxtUiCaches(owned, [path.join(owned, ".nuxt", "parent", ".cache")]),
      /symlink/,
    );
    fs.symlinkSync(path.join(foreign, ".cache"), path.join(owned, ".vite"), "dir");
    assert.throws(() => removeOwnedNuxtUiCaches(owned, [path.join(owned, ".vite")]), /symlink/);
    assert.throws(
      () =>
        removeOwnedNuxtUiCaches(owned, [path.join(owned, ".nuxt"), path.join(foreign, ".cache")]),
      /owned physical/,
    );
    assert.equal(
      fs.readFileSync(path.join(owned, ".nuxt", "keep"), "utf8"),
      "owned cache stays on refusal",
    );
    assert.equal(
      fs.readFileSync(path.join(foreign, ".cache", "keep"), "utf8"),
      "foreign provider exact bytes",
    );
  }));

test("regular owned generated caches are removed while authored and provider bytes remain", () =>
  temporary((directory) => {
    const owned = path.join(directory, "fixture");
    const caches = [path.join(owned, ".nuxt"), path.join(owned, "node_modules", ".cache")];
    for (const cache of caches) {
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, "generated"), "cache");
    }
    const source = path.join(owned, "Select.vue");
    const provider = path.join(owned, "node_modules", "provider.js");
    fs.writeFileSync(source, "complete authored Select source");
    fs.writeFileSync(provider, "complete installed provider bytes");
    const nested = path.join(owned, ".nuxt", "nested", ".vite");
    fs.mkdirSync(nested, { recursive: true });
    assert.deepEqual(
      removeOwnedNuxtUiCaches(owned, [
        ...caches,
        nested,
        fs.realpathSync(caches[0]!),
        path.join(owned, "missing", ".vite"),
      ]),
      [
        path.join(fs.realpathSync(owned), ".nuxt"),
        path.join(fs.realpathSync(owned), "node_modules", ".cache"),
      ],
    );
    assert.ok(caches.every((cache) => !fs.existsSync(cache)));
    assert.equal(fs.readFileSync(source, "utf8"), "complete authored Select source");
    assert.equal(fs.readFileSync(provider, "utf8"), "complete installed provider bytes");
  }));

test("ordinary setup is unchanged and invalid paired modes refuse", () =>
  temporary((directory) => {
    delete process.env.VIZE_NUXT_UI_COMPILER_PHASE;
    const config = path.join(directory, "nuxt.config.ts");
    fs.writeFileSync(config, "ordinary configuration");
    configureNuxtUiAuthority(config);
    assert.equal(fs.readFileSync(config, "utf8"), "ordinary configuration");
    assert.equal(authorityDirectory(), undefined);
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "stock-ish";
    assert.throws(() => authorityDirectory());
  }));

test("actual stock ownership is required and native owners are refused", () =>
  temporary(async () => {
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "reference";
    await assert.rejects(observe([], true), /exactly one/);
    await assert.rejects(
      observe([{ name: "vite:vue" }, { name: "vite-plugin-vize" }], true),
      /native Vize/,
    );
    await assert.rejects(
      observe([{ name: "vite:vue" }, { name: "vite:vue" }], true),
      /exactly one/,
    );
    await observe([{ name: "vite:vue" }], true);
    assert.throws(() =>
      summarizeNuxtUiTransforms(process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY!, "/fixture"),
    );
  }));

test("observer returns the identical result, map, context and arguments", () =>
  temporary(async () => {
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "reference";
    const context = { environment: { name: "ssr" } };
    const options = { ssr: true };
    const result = {
      code: "complete compiler output",
      map: { mappings: "AAAA", sources: ["Select.vue"] },
    };
    let calls = 0;
    const plugin: CompilerPlugin = {
      name: "vite:vue",
      transform: {
        order: "post",
        handler: function (this: unknown, code: string, id: string, received: unknown) {
          calls++;
          assert.equal(this, context);
          assert.equal(code, "complete source");
          assert.equal(id, "/fixture/src/runtime/components/Select.vue");
          assert.equal(received, options);
          return result;
        },
      },
    };
    await observe([plugin], true);
    const transform = plugin.transform;
    assert.ok(transform && typeof transform !== "function");
    assert.equal(transform.order, "post");
    assert.equal(
      await transform.handler.call(
        context,
        "complete source",
        "/fixture/src/runtime/components/Select.vue",
        options,
      ),
      result,
    );
    assert.equal(calls, 1);
  }));

test("observer preserves compiler errors and null transform results", () =>
  temporary(async () => {
    process.env.VIZE_NUXT_UI_COMPILER_PHASE = "reference";
    const failure = new Error("original compiler failure");
    const plugin = {
      name: "vite:vue",
      transform: async (_code: string) => {
        throw failure;
      },
    };
    await observe([plugin], false);
    await assert.rejects(
      () => plugin.transform("source"),
      (error) => error === failure,
    );
    const ignored: CompilerPlugin = { name: "vite:vue", transform: () => null };
    await observe([ignored], false);
    const transform = ignored.transform;
    assert.ok(typeof transform === "function");
    assert.equal(await transform.call({}, "source", "/ignored"), null);
  }));

test("both observed compiler lanes are mandatory and captured bytes cannot be replaced", () =>
  temporary(async (directory) => {
    const id = "/fixture/src/runtime/components/Select.vue";
    for (const phase of ["candidate", "reference"] as const) {
      process.env.VIZE_NUXT_UI_COMPILER_PHASE = phase;
      const plugin: CompilerPlugin = {
        name: phase === "candidate" ? "vite-plugin-vize" : "vite:vue",
        transform: (_source, _id, options) => ({
          code: options?.ssr ? "SSR entire output" : "client entire output",
          map: null,
        }),
      };
      await observe([plugin], false);
      const transform = plugin.transform;
      assert.equal(typeof transform, "function");
      if (typeof transform !== "function") assert.fail("function hook expected");
      await transform.call({ environment: { name: "client" } }, "whole SFC", id, { ssr: false });
      await transform.call({ environment: { name: "ssr" } }, "whole SFC", id, { ssr: true });
    }
    const summary = summarizeNuxtUiTransforms(directory, "/fixture");
    assert.deepEqual(
      summary.map((row) => [
        row.phase,
        row.requiredActualCompiler,
        row.actualSelectTransforms.map((record) => [record.plugin, record.id, record.ssr]),
      ]),
      [
        [
          "candidate",
          "vite-plugin-vize",
          [
            ["vite-plugin-vize", id, false],
            ["vite-plugin-vize", id, true],
          ],
        ],
        [
          "reference",
          "vite:vue",
          [
            ["vite:vue", id, false],
            ["vite:vue", id, true],
          ],
        ],
      ],
    );
    const reference = summary.find((row) => row.phase === "reference");
    const ssr = reference?.actualSelectTransforms.find((record) => record.ssr);
    assert.ok(ssr);
    const output = path.join(ssr.directory, "output.js");
    const before = fs.readFileSync(output);
    fs.writeFileSync(output, "borrowed cached output");
    assert.throws(() => summarizeNuxtUiTransforms(directory, "/fixture"));
    fs.writeFileSync(output, before);
    fs.rmSync(ssr.directory, { recursive: true });
    assert.throws(() => summarizeNuxtUiTransforms(directory, "/fixture"), /freshly compile/);
  }));
