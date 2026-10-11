import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  expectedBuildIdentity,
  LEGACY_BUILD_RECIPE,
  writeBuildReceipt,
} from "../../../differential/build-receipt.ts";
import { sha256 } from "../../../differential/sha256.ts";
import { command, json, successful } from "./command.ts";
import { DIAGNOSTIC_RECIPE, FROZEN_SOURCE, type MemoryBinding } from "./launch.ts";

export const rawGit = (root: string, ...args: string[]) =>
  execFileSync("git", ["--no-replace-objects", ...args], { cwd: root });

/** Both builds share dependency artifacts; each actual executable is retained before the next build. */
export async function buildArm(
  driver: string,
  source: string,
  output: string,
  role: MemoryBinding["role"],
  backend: string,
  env: NodeJS.ProcessEnv,
): Promise<MemoryBinding> {
  assert.equal(env.CARGO_TARGET_DIR, path.join(driver, "target"));
  const first = role === "first-original-ci";
  const revision = rawGit(source, "rev-parse", "HEAD").toString().trim();
  assert(first ? revision === FROZEN_SOURCE : revision !== FROZEN_SOURCE);
  assert.equal(
    rawGit(source, "status", "--porcelain", "--untracked-files=no").toString().trim(),
    "",
  );
  fs.mkdirSync(output, { recursive: true });
  const recipe = first ? LEGACY_BUILD_RECIPE : DIAGNOSTIC_RECIPE;
  const args = first
    ? ["build", "--profile", "ci", "-p", "vize", "--features", "legacy"]
    : ["build", "--profile", "ci", "-p", "vize", "--features", "legacy,allocation-diagnostic"];
  const result = await command(path.join(output, "build-command"), "cargo", args, source, env);
  successful(result);
  const actual = path.join(env.CARGO_TARGET_DIR!, "ci/vize");
  const binary = path.join(source, "target/ci/vize");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  if (fs.realpathSync(actual) !== (fs.existsSync(binary) ? fs.realpathSync(binary) : binary))
    fs.copyFileSync(actual, binary, fs.constants.COPYFILE_EXCL);
  const expected = expectedBuildIdentity(source);
  assert.equal(expected.sourceRevision, revision);
  assert.equal(expected.binarySha256, sha256(fs.readFileSync(actual)));
  const receiptPath = first ? writeBuildReceipt(source, recipe) : `${binary}.allocation-build.json`;
  if (!first)
    json(receiptPath, {
      schema: "vize.lsp.allocation.diagnostic.build",
      version: 1,
      recipe,
      ...expected,
      acceptanceCredit: "none",
    });
  const receipt = fs.readFileSync(receiptPath);
  fs.copyFileSync(binary, path.join(output, "actual-vize"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, "actual-build-receipt.json"), receipt, { flag: "wx" });
  json(path.join(output, "source-build.json"), {
    role,
    recipe,
    ...expected,
    actualBuildOutput: actual,
    retainedBinary: "actual-vize",
    retainedBinarySha256: sha256(fs.readFileSync(path.join(output, "actual-vize"))),
    receiptSha256: sha256(receipt),
    sourceTree: rawGit(source, "rev-parse", "HEAD^{tree}").toString().trim(),
    configuration: [
      "Cargo.toml",
      "Cargo.lock",
      ".cargo/config.toml",
      "rust-toolchain.toml",
      "crates/vize/Cargo.toml",
      "crates/vize_canon/Cargo.toml",
    ].map((file) => ({ path: file, sha256: sha256(fs.readFileSync(path.join(source, file))) })),
    toolchain: {
      node: process.version,
      rust: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
      cargo: execFileSync("cargo", ["--version"], { encoding: "utf8" }).trim(),
    },
    historicalExecutableAvailable: false,
    historicalByteReplayCredit: "none",
    acceptanceCredit: "none",
  });
  return {
    role,
    sourceRoot: source,
    outputRoot: path.join(output, "session"),
    sourceRevision: revision,
    binarySha256: String(expected.binarySha256),
    receiptSha256: sha256(receipt),
    backendPath: backend,
    backendSha256: sha256(fs.readFileSync(backend)),
  };
}
