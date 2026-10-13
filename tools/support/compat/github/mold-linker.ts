import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";

const original = "wild-linker/action@0bbbfa5df4380cab8e63cb8505a1ce65e1d10203";
const recovery = "./.github/actions/setup-wild-http-recovery";
const mold = /^\.\/(?:head\/|harness\/)?\.github\/actions\/setup-mold$/;

export function isMoldLinkerMigration(before: string, after: string): boolean {
  let replacements = 0;
  function normalize(value: unknown, previous: boolean): unknown {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, previous));
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalize(entry, previous)]),
    );
    if (previous && (result.uses === original || result.uses === recovery)) {
      if (result.with && !isDeepStrictEqual(result.with, { "wild-version": "0.9.0" }))
        return result;
      replacements++;
      result.uses = "approved-native-linker";
      delete result.with;
      if (typeof result.name === "string")
        result.name = result.name
          .replace("Setup Wild linker recovery (SSR-Pug)", "Setup mold linker (SSR-Pug)")
          .replace("Setup Wild linker", "Setup mold linker");
    } else if (!previous && typeof result.uses === "string" && mold.test(result.uses)) {
      result.uses = "approved-native-linker";
    }
    return result;
  }
  const left = normalize(parse(before), true);
  const right = normalize(parse(after), false);
  return replacements > 0 && isDeepStrictEqual(left, right);
}

// These CI-only additions do not change any original400 workload or product
// source. Workflow migrations still compare every remaining parsed field.
const support = new Set([
  ".github/actions/setup-mold/action.yml",
  ".github/workflows/mold-linker.yml",
  "tools/support/compat/github/mold-linker.ts",
  "tools/support/compat/github/source-cli-identity.ts",
  "tests/tooling/mold-linker.test.ts",
  "tests/tooling/github-source-cli-artifact.test.ts",
  "tests/tooling/github-workflows.test.ts",
  "tests/tooling/github-workflows-benchmark.test.ts",
  "tests/tooling/github-workflows-js-check-runtime.test.ts",
  "tests/tooling/github-workflows-release-build.test.ts",
  "tests/tooling/native-image-producer-workflow.test.ts",
  "tests/tooling/native-smoke-workflow.test.ts",
  "tests/tooling/real-project-matrix-lsp-wire.test.ts",
  "tests/tooling/rust-cache-docs-wasm-consumers.test.mjs",
  "tests/tooling/support/rust-cache-docs-wasm-consumers.mjs",
  "tests/tooling/vuefes-failure-sidecar-policy.test.mjs",
  "tests/tooling/fresco-workflow.test.ts",
  "tests/tooling/release/release-preflight-workflow.test.ts",
  "tests/tooling/rust-differential-sibling.test.mjs",
  "tests/tooling/setup-wild-http-recovery.test.mjs",
  "docs/davinci/decisions/2026-10-13-6830-mold-linker.md",
]);

export function moldLinkerHarness(changed: string[], root: string, before: string, after: string) {
  const read = (revision: string, file: string) =>
    execFileSync("git", ["show", `${revision}:${file}`], { cwd: root, encoding: "utf8" });
  return changed.filter((file) => {
    if (support.has(file)) return true;
    if (!file.startsWith(".github/") || !file.endsWith(".yml")) return false;
    return isMoldLinkerMigration(read(before, file), read(after, file));
  });
}
