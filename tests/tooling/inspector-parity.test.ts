import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { inspectorReportDirectory } from "../_helpers/inspector-parity.ts";
import {
  assertInspectorFileCoverage,
  assertInspectorPolicyDisjoint,
  inspectorOriginalInputs,
} from "../_helpers/inspector-original-inputs.ts";

test("inspector reports use the shared artifact directory by default", () => {
  const outputDirectory = inspectorReportDirectory("Example / Application");

  const expectedSuffix = path.join(".vize", "artifacts", "inspect", "Example-Application");
  assert.ok(
    outputDirectory.endsWith(expectedSuffix),
    `Expected path to end with "${expectedSuffix}", but got "${outputDirectory}"`,
  );
});

test("inspector reports preserve an explicit output directory", () => {
  assert.equal(
    inspectorReportDirectory("Example", "/tmp/inspection-output"),
    "/tmp/inspection-output",
  );
});

test("Inspector membership keeps every original input once and the actual same-child source", () => {
  const expected = [
    { path: "app/App.vue", source: "<template>original</template>\n" },
    { path: "app/nested/Child.vue", source: "<template>child</template>\n" },
  ];
  const names = expected.map((file) => file.path);
  const report = (paths: string[], fileCount = paths.length) => ({
    target: "dom" as const,
    summary: { fileCount },
    files: paths.map((path) => ({ path })),
  });
  const input = {
    target: "dom",
    files: expected.map((file) => ({ ...file, vizeCode: "real child output" })),
  };
  assertInspectorFileCoverage(report(names.toReversed()), expected, input);
  assertInspectorFileCoverage(
    report(names.map((name) => name.replaceAll("/", "\\"))),
    expected,
    input,
  );
  for (const paths of [
    [names[0]],
    [names[0], names[0]],
    [names[0], "app/ignored.ts"],
    [...names, "app/extra.vue"],
    [],
  ])
    assert.throws(
      () => assertInspectorFileCoverage(report(paths, 2), expected, input),
      /every original source exactly once/,
    );
  assert.throws(
    () => assertInspectorFileCoverage(report(names, 1), expected, input),
    /source count/,
  );
  assert.throws(() => assertInspectorFileCoverage(report([]), [], input), /original source inputs/);
  for (const path of ["file:///app/App.vue", "../app/App.vue", "/app/App.vue", "app/./App.vue"])
    assert.throws(() => assertInspectorFileCoverage(report([path, names[1]]), expected, input));
  for (const changed of [
    { ...input, target: "ssr" },
    { ...input, files: input.files.slice(1) },
    { ...input, files: [input.files[0], input.files[0]] },
    { ...input, files: [{ ...input.files[0], source: "changed same path" }, input.files[1]] },
    { ...input, files: [...input.files, { path: "app/extra.vue", source: "extra" }] },
    null,
  ])
    assert.throws(() => assertInspectorFileCoverage(report(names), expected, changed));
});

test("Inspector policy admission proves disjointness and refuses possibly excluded members", () => {
  const names = ["app/App.vue", "app/nested/Child.vue"];
  assertInspectorPolicyDisjoint(
    "# authored\n/app/generated/\nnode_modules/\n*.log\n!app/App.vue\n",
    names,
  );
  assertInspectorPolicyDisjoint("npm/*/dist/\n*.node\n.cache/\n", [
    "tests/_fixtures/_git/world/app/App.vue",
  ]);
  for (const policy of [
    "*.vue",
    "app/",
    "/app/App.vue",
    "nested/",
    "app/*/Child.vue",
    "**/*.vue",
    "[AC]*.vue",
    "app/\\*.vue",
    "app/App.vue ",
  ])
    assert.throws(() => assertInspectorPolicyDisjoint(policy, names));
  // A wildcard matching a parent directory can exclude a nested Vue source.
  assert.throws(() => assertInspectorPolicyDisjoint("*.log", ["app/cache.log/Child.vue"]));
});

test("Inspector policy proves literal suffixes and required path components without ignoring matches", () => {
  const members = ["app/App.vue", "app/nested/Child.vue"];
  assertInspectorPolicyDisjoint("*~\n*swp\n*swo\n*storybook.log\n**/__screenshots__/**\n", members);
  assertInspectorPolicyDisjoint("**/generated-assets/**\n*.backup-copy\n", members);
  for (const [policy, member] of [
    ["*~", "app~/Child.vue"],
    ["*swp", "app/tempswp/Child.vue"],
    ["*storybook.log", "app/mystorybook.log/Child.vue"],
    ["**/__screenshots__/**", "app/__screenshots__/Shot.vue"],
    ["**/generated-assets/**", "generated-assets/App.vue"],
    ["**/Child.vue", "Child.vue"],
    ["**/Child.vue", "app/nested/Child.vue"],
    ["app/**", "app/nested/Child.vue"],
    ["*.backup-copy", "app/archive.backup-copy/Child.vue"],
    ["**/{absent,app}/**", "app/App.vue"],
    ["**/[a]pp/**", "app/App.vue"],
    ["**/a?p/**", "app/App.vue"],
  ])
    assert.throws(
      () => assertInspectorPolicyDisjoint(policy, [member]),
      /may exclude original input/,
    );
});

test("fixed Gitlink authority rejects original deletion, rename, byte drift and unknown policies", (t) => {
  const repository = realpathSync(mkdtempSync(path.join(tmpdir(), "inspector-fixed-world-")));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const fixture = path.join(repository, "fixtures/world");
  const packet = path.join(repository, "packet");
  mkdirSync(path.join(fixture, "app/nested"), { recursive: true });
  mkdirSync(packet);
  const empty = path.join(repository, "empty-global-config");
  writeFileSync(empty, "");
  const keys = ["HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = key.startsWith("GIT_") ? empty : repository;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" });
  const commit = (cwd: string) =>
    git(
      cwd,
      "-c",
      "user.name=Inspector fixture",
      "-c",
      "user.email=inspector@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixed source",
    );
  try {
    git(repository, "init", "--quiet");
    git(fixture, "init", "--quiet");
    const app = path.join(fixture, "app/App.vue");
    const child = path.join(fixture, "app/nested/Child.vue");
    const original = "<template>original</template>\n";
    writeFileSync(app, original);
    writeFileSync(child, "<template>child</template>\n");
    writeFileSync(path.join(fixture, ".gitignore"), "/app/generated/\n");
    git(fixture, "add", ".");
    commit(fixture);
    const pin = git(fixture, "rev-parse", "HEAD").trim();
    git(repository, "update-index", "--add", "--cacheinfo", `160000,${pin},fixtures/world`);
    commit(repository);
    const check = { cwd: fixture, patterns: ["app/**/*.vue"] };
    const authority = { gitlink: "fixtures/world" };
    const load = () => inspectorOriginalInputs(repository, check, authority, packet);
    assert.deepEqual(
      load().map((file) => file.path),
      ["app/App.vue", "app/nested/Child.vue"],
    );
    // Generated ignored files are not substituted for the fixed authored set.
    mkdirSync(path.join(fixture, "app/generated"));
    for (let index = 0; index < 51; index++)
      writeFileSync(path.join(fixture, "app/generated", `Generated ${index}.vue`), "generated\n");
    assert.equal(load().length, 2);
    writeFileSync(app, "same filename, changed source\n");
    assert.throws(load, /differs from fixed Git object/);
    writeFileSync(app, original);
    const renamed = path.join(fixture, "app/nested/Renamed.vue");
    renameSync(child, renamed);
    assert.throws(load);
    renameSync(renamed, child);
    unlinkSync(child);
    assert.throws(load);
    writeFileSync(child, "<template>child</template>\n");
    const marker = path.join(fixture, "app/.ignore");
    writeFileSync(marker, "# unknown walker policy\n");
    assert.throws(load, /unsupported .ignore/);
    unlinkSync(marker);
    const parentPolicy = path.join(repository, ".gitignore");
    writeFileSync(parentPolicy, "app/\n");
    assert.throws(load, /may exclude original input/);
    unlinkSync(parentPolicy);
    const exclude = path.join(fixture, ".git/info/exclude");
    const priorExclude = readFileSync(exclude);
    writeFileSync(exclude, "*.vue\n");
    assert.throws(load, /may exclude original input/);
    writeFileSync(exclude, priorExclude);
    writeFileSync(empty, "[core]\nexcludesFile = /unowned/policy\n");
    assert.throws(load, /configured global ignore/);
    writeFileSync(empty, "");
    const homeConfig = path.join(repository, ".gitconfig");
    writeFileSync(homeConfig, "[core]\nexcludesFile = /unowned/home-fallback-policy\n");
    assert.throws(load, /configured global ignore/);
    unlinkSync(homeConfig);
    if (process.platform !== "win32") {
      const ignored = path.join(fixture, "app/.ignore");
      symlinkSync("absent-ignore-target", ignored);
      assert.throws(load, /unsupported .ignore/);
      unlinkSync(ignored);
      const gitignore = path.join(fixture, "app/.gitignore");
      symlinkSync("absent-gitignore-target", gitignore);
      assert.throws(load, /ignore policy must be a regular file/);
      unlinkSync(gitignore);
      if (process.getuid?.() !== 0) {
        writeFileSync(gitignore, "*.vue\n");
        chmodSync(gitignore, 0);
        try {
          assert.throws(load, { code: "EACCES" });
        } finally {
          chmodSync(gitignore, 0o600);
          unlinkSync(gitignore);
        }
      }
    }
    assert.equal(load().length, 2);
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = path.join(repository, "absent-executables");
      assert.throws(load, { code: "ENOENT", syscall: "spawnSync git" });
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
    const metadata = path.join(fixture, ".git");
    const preserved = path.join(fixture, ".git-preserved");
    renameSync(metadata, preserved);
    try {
      writeFileSync(metadata, "gitdir: absent-metadata\n");
      assert.throws(load, /original-source Git authority refused/);
    } finally {
      unlinkSync(metadata);
      renameSync(preserved, metadata);
    }
    assert.throws(
      () =>
        inspectorOriginalInputs(
          repository,
          { ...check, patterns: ["app/*.vue"] },
          authority,
          packet,
        ),
      /unsupported Inspector source selection/,
    );
    const receipt = JSON.parse(
      readFileSync(path.join(packet, "original-source-authority.json"), "utf8"),
    );
    assert.match(receipt.failure, /unsupported Inspector source selection/);
    assert.equal(receipt.pin, pin);
    // A deliberate new authored Gitlink world derives its own membership.
    writeFileSync(
      path.join(fixture, "app/Added.vue"),
      "<template>new authored source</template>\n",
    );
    git(fixture, "add", "app/Added.vue");
    commit(fixture);
    const nextPin = git(fixture, "rev-parse", "HEAD").trim();
    git(repository, "update-index", "--cacheinfo", `160000,${nextPin},fixtures/world`);
    commit(repository);
    assert.deepEqual(
      load().map((file) => file.path),
      ["app/Added.vue", "app/App.vue", "app/nested/Child.vue"],
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Inspector formats real CommonJS Prettier output in both complete target routes", async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "inspector-commonjs-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const require = createRequire(new URL("../package.json", import.meta.url));
  const packageFile = require.resolve("prettier/package.json");
  const packageBytes = readFileSync(packageFile);
  const version = JSON.parse(packageBytes.toString("utf8")).version;
  const prettierRoot = path.join(root, "node_modules/prettier");
  mkdirSync(path.join(prettierRoot, "plugins"), { recursive: true });
  writeFileSync(path.join(prettierRoot, "package.json"), packageBytes);
  const providers = ["standalone", "plugins/babel", "plugins/estree", "plugins/typescript"].map(
    (entry) => {
      const file = require.resolve(`prettier/${entry}`);
      const bytes = readFileSync(file);
      copyFileSync(file, path.join(prettierRoot, `${entry}.js`));
      return { specifier: `prettier/${entry}`, file, bytes };
    },
  );
  const prettier = require("prettier/standalone");
  const estree = require("prettier/plugins/estree");
  const embedded = readFileSync(
    new URL("../../crates/vize/src/commands/inspector/official_compiler.ts", import.meta.url),
    "utf8",
  );
  for (const target of ["dom", "ssr"]) {
    for (const parser of ["babel", "typescript"]) {
      const typescript = parser === "typescript";
      const raw = typescript ? "const answer:number=1" : "const answer={value:1}";
      const expected = typescript
        ? "const answer: number = 1;\n"
        : "const answer = { value: 1 };\n";
      const source = typescript
        ? '<script setup lang="ts">const answer:number=1</script><template>{{answer}}</template>'
        : "<script setup>const answer={value:1}</script><template>{{answer.value}}</template>";
      const directory = path.join(root, `${target}-${parser}`);
      const input = JSON.stringify({
        target,
        moduleRoot: fileURLToPath(new URL("../", import.meta.url)),
        files: [{ path: "Original.vue", source, vizeCode: raw }],
      });
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", embedded], {
        cwd: root,
        env: { ...process.env, VIZE_INSPECTOR_CAPTURE_DIR: directory },
        input,
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.files.length, 1);
      const file = report.files[0];
      assert.equal(file.path, "Original.vue");
      assert.equal(file.parser, parser);
      assert.equal(file.official.error, null);
      assert.deepEqual(file.official.warnings, []);
      assert.equal(file.vizeFormattedCode, expected);
      assert.notEqual(file.official.formattedCode, file.official.code);
      assert.equal(
        file.official.formattedCode,
        await prettier.format(file.official.code, {
          parser,
          plugins: [require(`prettier/plugins/${typescript ? "typescript" : "babel"}`), estree],
          semi: true,
          singleQuote: false,
          printWidth: 100,
        }),
      );
      assert.equal(readFileSync(path.join(directory, "input.json"), "utf8"), input);
      const receipt = JSON.parse(readFileSync(path.join(directory, "receipt.json"), "utf8"));
      assert.deepEqual(receipt.pendingImports, []);
      assert.equal(receipt.formatEvents.length, 2);
      assert.ok(receipt.formatEvents.every((event: any) => event.status === "formatted"));
      for (const provider of providers) {
        const loaded = receipt.imports.find(
          (entry: any) => entry.specifier === provider.specifier && entry.status === "loaded",
        );
        assert.ok(loaded);
        assert.equal(loaded.package.name, "prettier");
        assert.equal(loaded.package.version, version);
        assert.equal(loaded.root, root);
        assert.equal(
          loaded.image.sha256,
          createHash("sha256").update(provider.bytes).digest("hex"),
        );
        assert.deepEqual(
          readFileSync(path.join(directory, loaded.image.retainedBytes)),
          provider.bytes,
        );
      }
    }
  }
  for (const provider of providers) assert.deepEqual(readFileSync(provider.file), provider.bytes);
  assert.deepEqual(readFileSync(packageFile), packageBytes);
});
