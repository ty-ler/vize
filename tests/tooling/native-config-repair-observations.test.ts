import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { failedConfigModuleRequests } from "../../crates/vize_carton/src/config/loader/module-runtime.mjs";

const require = createRequire(import.meta.url);
const vite = dirname(require.resolve("vite/package.json"));
const loader = new URL("../../crates/vize_carton/src/config/loader/js.rs", import.meta.url);
const rust = await readFile(loader, "utf8");
const embedded =
  (
    await Promise.all(
      [...rust.matchAll(/include_str!\("([^"]+)"\)/g)].map((match) =>
        readFile(new URL(match[1], loader), "utf8"),
      ),
    )
  ).join("") + [...rust.matchAll(/r#"([\s\S]*?)"#/g)][0][1];

for (const installedVite of [false, true]) {
  for (const policyName of ["shared-policy.mjs", "共有 policy.mjs"]) {
    test(`native loader retains an explicit outside failed request and repairs without replacing its loader (Vite: ${installedVite}, path: ${policyName})`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), "vize-config-repair-")));
      try {
        const app = join(root, "app");
        await mkdir(app);
        await writeFile(join(app, "package.json"), '{"type":"module"}');
        if (installedVite) {
          await mkdir(join(app, "node_modules"));
          await symlink(vite, join(app, "node_modules/vite"), "junction");
        }
        const selected = join(app, "vite.config.mjs");
        const policy = join(root, policyName);
        await writeFile(
          selected,
          `import vue from ${JSON.stringify(`../${policyName}`)}; export default { vue };`,
        );
        const invoke = () =>
          spawnSync(process.execPath, ["--input-type=module", "-e", embedded, selected], {
            cwd: app,
            encoding: "utf8",
          });
        const missing = invoke();
        assert.equal(missing.status, 1, missing.stderr);
        const observed = JSON.parse(missing.stdout);
        assert.equal("config" in observed, false, "failed options must not become a configuration");
        assert.ok(observed.dependencies.includes(selected));
        assert.ok(observed.dependencies.includes(policy));
        await writeFile(policy, "export default { formatter: { printWidth: 91 } };");
        const repaired = invoke();
        assert.equal(repaired.status, 0, repaired.stderr);
        const loaded = JSON.parse(repaired.stdout);
        assert.equal(loaded.config.formatter.printWidth, 91);
        assert.ok(loaded.dependencies.includes(policy));
        await rm(policy);
        const deleted = invoke();
        assert.equal(deleted.status, 1, deleted.stderr);
        assert.deepEqual(JSON.parse(deleted.stdout), observed);
        await writeFile(policy, "export default { formatter: { printWidth: 87 } };");
        const recreated = invoke();
        assert.equal(recreated.status, 0, recreated.stderr);
        assert.equal(JSON.parse(recreated.stdout).config.formatter.printWidth, 87);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

test("failed request observations use native structured fields without guessing package or extension resolution", () => {
  const importer = join(tmpdir(), "app", "vite.config.mjs");
  const requested = join(tmpdir(), "shared-policy.mjs");
  assert.deepEqual(
    failedConfigModuleRequests({
      code: "ERR_MODULE_NOT_FOUND",
      url: pathToFileURL(requested).href,
    }),
    [requested],
  );
  assert.deepEqual(
    failedConfigModuleRequests({
      errors: [{ code: "UNRESOLVED_IMPORT", id: importer, exporter: "../shared-policy.mjs" }],
    }),
    [importer, requested],
  );
  for (const exporter of [
    "policy",
    "@scope/policy",
    "../policy",
    "https://example.com/policy.mjs",
    "../hash#policy.mjs",
    "../query?policy.mjs",
    "../percent%25policy.mjs",
  ]) {
    assert.deepEqual(
      failedConfigModuleRequests({
        errors: [{ code: "UNRESOLVED_IMPORT", id: importer, exporter }],
      }),
      [importer],
    );
  }
  for (const error of [
    null,
    "Cannot resolve ../shared-policy.mjs",
    { message: `Cannot resolve ${requested}` },
    { errors: [{ text: `Cannot resolve ${requested}`, location: { file: importer } }] },
    { errors: [{ code: "CUSTOM_RESOLVE_ERROR", id: importer, exporter: "../shared-policy.mjs" }] },
    { code: "ERR_MODULE_NOT_FOUND", url: "https://example.com/policy.mjs" },
  ]) {
    assert.deepEqual(failedConfigModuleRequests(error), []);
  }
});
