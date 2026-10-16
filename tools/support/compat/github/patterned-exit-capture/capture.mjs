import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helper = path.dirname(fileURLToPath(import.meta.url));
const [historical, current, output] = process.argv.slice(2).map((item) => path.resolve(item));
assert.equal(process.platform, "linux");
assert.equal(process.version, "v24.14.0");
fs.mkdirSync(output); // Refuse reuse of an earlier attempt's evidence.
fs.mkdirSync(path.join(output, "images"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (filename, value) =>
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const oldSha = "9b6a83d95ffc0f555d120323c94c8c3ea9b7f333";
const currentSha = "2cb20631e67097389c09aa4ec278f323fc923e19";
const input = fs.readFileSync(path.join(helper, "input.json"));
assert.equal(hash(input), "2f056e942aefc05b2ee4e0a79885820295aa1a51460f23c9a35049b1e48ac9db");
fs.writeFileSync(path.join(output, "input.bin"), input, { flag: "wx" });
const relativeTrace = "tests/tooling/support/davinci-mounted-trace.mjs";
const relativeRunner = "tests/tooling/support/patterned-template-runtime.mjs";
function source(root, expected) {
  assert.equal(git(root, "rev-parse", "HEAD").trim(), expected);
  assert.equal(
    git(
      root,
      "diff",
      "--name-only",
      "HEAD",
      "--",
      "tests/tooling/support",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tests/package.json",
    ),
    "",
  );
  const names = git(
    root,
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "tests/tooling/support",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tests/package.json",
  )
    .trim()
    .split("\n");
  return {
    sourceSha: expected,
    tree: git(root, "rev-parse", "HEAD^{tree}").trim(),
    root,
    files: names.map((name) => ({ name, sha256: hash(fs.readFileSync(path.join(root, name))) })),
  };
}
const orchestrationSha = git(helper, "rev-parse", "HEAD").trim();
if (process.env.GITHUB_SHA) assert.equal(orchestrationSha, process.env.GITHUB_SHA);
const sources = { historical: source(historical, oldSha), current: source(current, currentSha) };
const runtimeBody = (root) =>
  fs
    .readFileSync(path.join(root, relativeTrace), "utf8")
    .split("export async function loadRuntime(")[1]
    .split("\n}\n")[0];
assert.ok(runtimeBody(historical));
assert.equal(
  runtimeBody(historical),
  runtimeBody(current),
  "Exact original build flags/single-chunk assertion must agree",
);
json(path.join(output, "sources.json"), {
  orchestrationSha,
  sources,
  inputSha256: hash(input),
  loadRuntimeBodySha256: hash(runtimeBody(historical)),
  helpers: ["capture.mjs", "preload.cjs", "build-only.mjs", "input.json"].map((name) => ({
    name,
    sha256: hash(fs.readFileSync(path.join(helper, name))),
  })),
  topology:
    "Diagnostic Node parent, sequential children; not the original 16-slot full workspace topology",
  observation:
    "Synchronous preload/module hooks add overhead; no native crash elimination inference from successes",
  coreCapture:
    "disabled; no global core_pattern or limits changes; no authenticated private guest proof",
});

const outcomes = [];
async function run(name, root, sourceKey, args, expected, synthetic = false) {
  const directory = path.join(output, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "input.bin"), input, { flag: "wx" });
  let child;
  const outcome = await new Promise((resolve) => {
    const stdout = [],
      stderr = [];
    let spawnError,
      timedOut = false;
    const env = { ...process.env };
    for (const key of [
      "NODE_OPTIONS",
      "NODE_PATH",
      "NODE_ENV",
      "VIZE_VUE_RUNTIME_PRODUCTION",
      "VIZE_MOUNTED_TRACE_OBSERVATIONS",
      "VIZE_VUE_RUNTIME_TRACE_EVIDENCE",
      "VIZE_VUE_RUNTIME_DEVTOOLS_OBSERVER",
    ])
      delete env[key];
    env.VIZE_PATTERNED_EXIT_PACKET = directory;
    env.VIZE_PATTERNED_EXIT_SOURCE = sources[sourceKey].sourceSha;
    child = spawn(process.execPath, ["--require", path.join(helper, "preload.cjs"), ...args], {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    json(path.join(directory, "invocation.json"), {
      name,
      synthetic,
      source: sources[sourceKey],
      executable: process.execPath,
      helpers: ["capture.mjs", "preload.cjs", "build-only.mjs"].map((name) => ({
        name,
        sha256: hash(fs.readFileSync(path.join(helper, name))),
      })),
      args: child.spawnargs,
      pid: child.pid,
      inputSha256: hash(input),
      expected,
      environment: { NODE_OPTIONS: null, NODE_ENV: null, VIZE_VUE_RUNTIME_PRODUCTION: null },
    });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      spawnError = String(error);
    });
    // EPIPE belongs to the outcome packet, not an unhandled parent exception.
    child.stdin.on("error", (error) => {
      spawnError ??= `stdin: ${error}`;
    });
    child.stdin.end(input);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout),
        err = Buffer.concat(stderr);
      fs.writeFileSync(path.join(directory, "stdout.bin"), out, { flag: "wx" });
      fs.writeFileSync(path.join(directory, "stderr.bin"), err, { flag: "wx" });
      resolve({
        name,
        synthetic,
        pid: child.pid,
        code,
        signal,
        timedOut,
        spawnError,
        stdout: { bytes: out.length, sha256: hash(out), text: out.toString("utf8") },
        stderr: { bytes: err.length, sha256: hash(err) },
        expected,
        statusMatches:
          code === expected.code &&
          signal === expected.signal &&
          out.equals(Buffer.from(expected.stdout)) &&
          err.equals(Buffer.alloc(0)) &&
          !spawnError &&
          !timedOut,
      });
    });
  });
  const events = fs.existsSync(path.join(directory, "events.jsonl"))
    ? fs
        .readFileSync(path.join(directory, "events.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
    : [];
  outcome.evidenceComplete =
    events.length > 0 &&
    events.every(
      (event) =>
        event.pid === child.pid &&
        event.birth === events[0].birth &&
        event.event !== "observation-gap",
    ) &&
    events[0].event === "start" &&
    events[0].executable?.sha256 &&
    (synthetic ||
      (events.some(
        (event) =>
          event.event === "dlopen-return" &&
          event.providers.some(
            (provider) => provider.filename.endsWith(".node") && provider.mappedIdentityMatches,
          ),
      ) &&
        events.some((event) => event.event === "data-module"))) &&
    (expected.signal !== null || events.some((event) => event.event === "exit"));
  // Any genuine signal is retained as failure even after the exact passing JSON.
  // A self-SIGSEGV control is explicitly synthetic and checked for that signal.
  outcome.accepted = Boolean(outcome.statusMatches && outcome.evidenceComplete);
  json(path.join(directory, "outcome.json"), outcome);
  outcomes.push(outcome);
  json(path.join(output, `progress-${outcomes.length}.json`), outcomes);
}
const passing = { code: 0, signal: null, stdout: '{"passed":1}' };
for (let trial = 1; trial <= 2; trial++) {
  await run(
    `historical-natural-${trial}`,
    historical,
    "historical",
    [path.join(historical, relativeRunner)],
    passing,
  );
  await run(
    `current-guarded-${trial}`,
    current,
    "current",
    [path.join(current, relativeRunner)],
    passing,
  );
  await run(
    `build-only-natural-${trial}`,
    historical,
    "historical",
    [path.join(helper, "build-only.mjs"), path.join(historical, relativeTrace)],
    { code: 0, signal: null, stdout: '{"built":1}' },
  );
}
const emit = `require('node:fs').writeSync(1, '{"passed":1}');`;
await run("synthetic-zero", historical, "historical", ["-e", emit], passing, true);
await run(
  "synthetic-exit1",
  historical,
  "historical",
  ["-e", `${emit}process.exitCode=1;`],
  { ...passing, code: 1 },
  true,
);
await run(
  "synthetic-sigsegv",
  historical,
  "historical",
  ["-e", `${emit}process.kill(process.pid,'SIGSEGV');`],
  { ...passing, code: null, signal: "SIGSEGV" },
  true,
);
source(historical, oldSha);
source(current, currentSha);
json(path.join(output, "summary.json"), {
  outcomes,
  accepted: outcomes.every((result) => result.accepted),
  genuineFaultReproduced: outcomes.some(
    (result) => !result.synthetic && result.signal === "SIGSEGV",
  ),
  limitation: "Six ordinary trials cannot prove elimination; guarded exits bypass native cleanup.",
});
if (outcomes.some((result) => !result.accepted)) process.exitCode = 1;
