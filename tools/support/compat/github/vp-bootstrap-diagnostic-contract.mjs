import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const ownedRef = "refs/heads/ci/vp-bootstrap-diagnostic-20261013";
export const versions = Object.freeze({
  setup: "ca1c46663915d6c1042ae23bd39ab85718bfb0fa",
  vp: "1.1.0",
  node: "24.14.0",
  bootstrapPnpm: "10.33.0",
  projectPnpm: "12.1.0",
  typescript: "7.0.2",
  vue: "3.5.35",
});
export const hash = (value) => createHash("sha256").update(value).digest("hex");

export function defaultBootstrapEnvironment(env) {
  for (const variable of [
    "VP_LOG",
    "VP_SKIP_DEPS_INSTALL",
    "VP_HOME",
    "VP_BIN_DIR",
    "VP_DATA_DIR",
    "VP_CACHE_DIR",
    "VP_NODE_DIST_MIRROR",
    "VP_NODE_SKIP_SIGNATURE_VERIFY",
    "VP_NODE_VERSION",
    "VP_NODE_MANAGER",
    "VP_PM_MANAGER",
    "VP_PR_VERSION",
  ]) {
    assert.equal(env[variable], undefined, `unexpected existing environment override: ${variable}`);
  }
}

export function context(env, arch = process.arch) {
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch", "manual diagnostic only");
  assert.equal(env.VIZE_DIAG_REQUESTED, "true", "diagnostic input must be explicitly enabled");
  assert.equal(env.GITHUB_REF, ownedRef, "diagnostic requires its owned branch");
  assert.equal(env.RUNNER_OS, "Linux");
  assert.equal(env.RUNNER_ARCH, arch === "x64" ? "X64" : "ARM64");
  assert(["x64", "arm64"].includes(arch));
  assert.match(env.GITHUB_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_REPOSITORY ?? "", /^[\w.-]+\/[\w.-]+$/);
  return {
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    run: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    os: "Linux",
    image: "ubuntu2404-glibc",
    arch,
    versions,
    dependencyCache: false,
  };
}

export function latestLts(index) {
  const entries = index.filter((entry) => entry.lts && /^v\d+\.\d+\.\d+$/.test(entry.version));
  assert(entries.length > 0, "official Node index has no LTS");
  entries.sort((a, b) => {
    const left = a.version.slice(1).split(".").map(Number);
    const right = b.version.slice(1).split(".").map(Number);
    for (let part = 0; part < 3; part++)
      if (left[part] !== right[part]) return right[part] - left[part];
    return 0;
  });
  return entries[0].version.slice(1);
}

export function cacheKey(identity, lts) {
  assert.match(lts, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(identity.versions, versions);
  return `vize-vp-diag-v1-owned-20261013-${identity.os}-${identity.image}-${identity.arch}-${identity.run}-${identity.attempt}-${identity.sha}-setup${versions.setup}-vp${versions.vp}-node${versions.node}-lts${lts}-pnpm${versions.bootstrapPnpm}-${versions.projectPnpm}-ts${versions.typescript}-vue${versions.vue}`;
}

export function cachePaths(home, lts) {
  assert.match(lts, /^\d+\.\d+\.\d+$/);
  const vpHome = join(home, ".vite-plus");
  return [...new Set([lts, versions.node])]
    .map((version) => join(vpHome, "js_runtime/node", version))
    .concat(join(vpHome, "package_manager/pnpm", versions.bootstrapPnpm));
}

export function verifyCustody(cold, identity, sources, expectedKey, expectedPlanHash) {
  assert.deepEqual(
    cold.identity,
    identity,
    "cold/warm run, source, architecture or versions differ",
  );
  assert.deepEqual(cold.sources, sources, "cold/warm source inputs differ");
  assert.equal(cold.key, cacheKey(identity, cold.bootstrapLts));
  assert.equal(cold.key, expectedKey, "warm cache key differs from cold output");
  assert.equal(hash(JSON.stringify(cold)), expectedPlanHash, "cold manifest digest differs");
}
