import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const output = path.join(root, "target/recursive-rename-diagnostic");
fs.mkdirSync(output, { recursive: true });
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const source = process.env.SOURCE_SHA;
assert.match(source ?? "", /^[0-9a-f]{40}$/);
assert.equal(process.env.VIZE_INLAY_HINT_CAPTURE, undefined, "no pre-initialize identity probes");
assert.equal(git("rev-parse", "HEAD"), source);
assert.equal(git("diff", "--name-only", "HEAD"), "");
const test = "native_recursive_parent_local_rename_keeps_every_recursive_source_byte";
const args = [
  "test",
  "--locked",
  "--profile",
  "ci",
  "-p",
  "vize",
  "--test",
  "lsp_recursive_prop_rename_cli",
  test,
  "--",
  "--exact",
  "--nocapture",
];
const fixtureRoot =
  "tests/_fixtures/differential/lsp/same-name-rename/7994/supplemental/recursive-prop-roles";
const sourceFiles = [
  "crates/vize/tests/lsp_recursive_prop_rename_cli.rs",
  "crates/vize/tests/lsp_recursive_prop_rename_cli/edits.rs",
  "crates/vize/tests/support/lsp_vue_project.rs",
  "crates/vize/tests/support/lsp_process.rs",
  "crates/vize/tests/support/lsp_process/passive.rs",
  "Cargo.lock",
  "pnpm-lock.yaml",
  ...git("ls-tree", "-r", "--name-only", "HEAD", "--", fixtureRoot).split("\n"),
];
const sourceInputs = sourceFiles.map((file) => {
  const bytes = fs.readFileSync(path.join(root, file));
  const destination = path.join(output, "source-inputs", file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  return {
    file,
    bytes: bytes.length,
    sha256: digest(bytes),
    gitBlob: git("rev-parse", `HEAD:${file}`),
  };
});
const artifacts = fs
  .readFileSync(path.join(output, "build.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const executable = (name: string, test: boolean) => {
  const candidates = artifacts.filter(
    (entry) =>
      entry.reason === "compiler-artifact" &&
      entry.target?.name === name &&
      entry.profile?.test === test &&
      entry.executable,
  );
  assert.equal(candidates.length, 1, `one exact built executable for ${name}/${test}`);
  return fs.realpathSync(candidates[0].executable);
};
const image = (file: string) => {
  const physical = fs.realpathSync(file);
  const bytes = fs.readFileSync(physical);
  return { path: physical, bytes: bytes.length, sha256: digest(bytes) };
};
const images = {
  cli: image(executable("vize", false)),
  test: image(executable("lsp_recursive_prop_rename_cli", true)),
  corsa: image(path.join(root, "node_modules/@typescript/typescript-linux-x64/lib/tsc")),
};
const passive = path.join(output, "passive");
const plan = {
  source,
  sourceTree: git("rev-parse", "HEAD^{tree}"),
  driver: process.env.DRIVER_SHA,
  observerSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
  lane: process.env.DIAGNOSTIC_LANE,
  command: ["cargo", ...args],
  sourceInputs,
  images,
  envelope: {
    disabledTsgo: process.env.VIZE_TEST_DISABLE_TSGO,
    rustTestThreads: process.env.RUST_TEST_THREADS,
  },
  observation:
    "Original complete test and timeouts, passive custody after teardown, existing preparation trace; instrumented diagnosis, no paired performance or full-health qualification",
  processSampling:
    "50ms observations, including PID birth/executable/cmdline; absence is not an observed native exit status and short-lived processes can be missed",
};
write("plan.json", plan);
const stdout = fs.openSync(path.join(output, "test.stdout"), "w");
const stderr = fs.openSync(path.join(output, "test.stderr"), "w");
const started = process.hrtime.bigint();
const child = spawn("cargo", args, {
  cwd: root,
  env: { ...process.env, VIZE_LSP_PASSIVE_EVIDENCE: passive },
  stdio: ["ignore", stdout, stderr],
});
const samples = fs.openSync(path.join(output, "processes.jsonl"), "w");
const retainedInputs = new Set<number>();
let samplingError: string | null = null;
const sample = () => {
  try {
    const rows = fs
      .readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .flatMap((name) => {
        try {
          const fields = fs
            .readFileSync(`/proc/${name}/stat`, "utf8")
            .split(") ")
            .at(-1)!
            .split(" ");
          return [{ pid: Number(name), ppid: Number(fields[1]), birthTicks: fields[19] }];
        } catch {
          return [];
        }
      });
    const selected = new Set([child.pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows)
        if (selected.has(row.ppid) && !selected.has(row.pid)) {
          selected.add(row.pid);
          changed = true;
        }
    }
    const processes = rows
      .filter((row) => selected.has(row.pid))
      .flatMap((row) => {
        try {
          const executable = fs.readlinkSync(`/proc/${row.pid}/exe`);
          const cwd = fs.readlinkSync(`/proc/${row.pid}/cwd`);
          if (executable === images.cli.path && !retainedInputs.has(row.pid)) {
            retainedInputs.add(row.pid);
            const originals = ["Recursive.vue", "Parent.vue", "tsconfig.json", "vize.config.json"];
            for (const file of originals) {
              const bytes = fs.readFileSync(path.join(cwd, file));
              const destination = path.join(output, `process-inputs-${row.pid}`, file);
              fs.mkdirSync(path.dirname(destination), { recursive: true });
              fs.writeFileSync(destination, bytes);
            }
          }
          return [
            {
              ...row,
              executable,
              cwd,
              imageSha256: Object.values(images).find((image) => image.path === executable)?.sha256,
              cmdlineBase64: fs.readFileSync(`/proc/${row.pid}/cmdline`).toString("base64"),
            },
          ];
        } catch {
          return [];
        }
      });
    fs.writeSync(
      samples,
      JSON.stringify({ elapsedNs: (process.hrtime.bigint() - started).toString(), processes }) +
        "\n",
    );
  } catch (error) {
    samplingError = String(error);
  }
};
sample();
const timer = setInterval(sample, 50);
const terminal = await new Promise<{ code: number | null; signal: string | null; error?: string }>(
  (resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error: String(error) }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  },
);
clearInterval(timer);
sample();
fs.closeSync(stdout);
fs.closeSync(stderr);
fs.closeSync(samples);
const sourceAfter = sourceInputs.map(({ file }) => ({
  file,
  sha256: digest(fs.readFileSync(path.join(root, file))),
}));
const imagesAfter = Object.fromEntries(
  Object.entries(images).map(([name, before]) => [name, image(before.path)]),
);
const intact =
  sourceInputs.every((before, i) => before.sha256 === sourceAfter[i].sha256) &&
  Object.entries(images).every(([name, before]) => before.sha256 === imagesAfter[name].sha256) &&
  git("diff", "--name-only", "HEAD") === "";
const testOutput = fs
  .readFileSync(path.join(output, "test.stdout"), "utf8")
  .replace(/\u001b\[[0-9;]*m/g, "");
const completePass =
  testOutput.includes(`test ${test} ... ok`) &&
  testOutput.includes("1 passed; 0 failed; 0 ignored;");
const passiveProcesses = fs.existsSync(passive) ? fs.readdirSync(passive) : [];
const completePassive =
  passiveProcesses.length === 8 &&
  passiveProcesses.every(
    (directory) =>
      JSON.parse(fs.readFileSync(path.join(passive, directory, "manifest.json"), "utf8"))
        .complete === true,
  );
write("result.json", {
  ...terminal,
  intact,
  sourceAfter,
  imagesAfter,
  samplingError,
  completePass,
  completePassive,
  passiveProcesses,
  semantics:
    "Cargo status is observed. LSP terminal SIGKILL may be original test cleanup; sampled backend disappearance carries no inferred exit code or OOM attribution.",
});
console.log(JSON.stringify({ source, ...terminal, intact, samplingError, evidence: output }));
process.exitCode =
  terminal.code === 0 &&
  terminal.signal === null &&
  !terminal.error &&
  intact &&
  !samplingError &&
  completePass &&
  completePassive
    ? 0
    : 1;
