import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { createConnection } from "node:net";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import {
  fixtureIdentity,
  sealNuxtUiCandidate,
  stockNuxtUiCompilerConfig,
  summarizeNuxtUiTransforms,
} from "../../_helpers/nuxt-ui-compiler-authority.ts";
import {
  compareNuxtUiAuthoredIdentity,
  retainNuxtUiGeneratedOutput,
  verifyNuxtUiGeneratedOutputUnused,
} from "../../_helpers/nuxt-ui-output-authority.ts";

const root = path.resolve("target/app-e2e-logs/nuxt-ui-reference");
const tests = path.resolve("tests");
const budget = /^(\d+)m$/.exec(process.env.PLANNED_TIMEOUT ?? "");
assert.ok(budget, "the existing planner row budget is required");
const deadline = Date.now() + Number(budget[1]) * 60_000;
assert.equal(process.env.PLAN_PROFILE, "full");
assert.equal(process.env.PLAN_SUITE, "dev");
assert.equal(process.env.PLAN_SHARD, "nuxt-ui");
fs.mkdirSync(root, { recursive: true });
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);

async function run(phase: "candidate" | "reference", command: string, args: string[], cwd: string) {
  const remaining = deadline - Date.now();
  assert.ok(remaining > 0, "reference cannot extend the existing App row budget");
  const stdout = fs.openSync(path.join(root, `${phase}.stdout.txt`), "wx");
  const stderr = fs.openSync(path.join(root, `${phase}.stderr.txt`), "wx");
  const startedAt = new Date().toISOString();
  let error: unknown;
  const child = spawn(command, args, {
    cwd,
    timeout: remaining,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      VIZE_NUXT_UI_COMPILER_PHASE: phase,
      VIZE_NUXT_UI_COMPILER_AUTHORITY: root,
    },
  });
  child.stdout.on("data", (data: Buffer) => {
    fs.writeSync(stdout, data);
    process.stdout.write(data);
  });
  child.stderr.on("data", (data: Buffer) => {
    fs.writeSync(stderr, data);
    process.stderr.write(data);
  });
  child.once("error", (value) => {
    const raw = (item: unknown) =>
      inspect(item, { depth: null, showHidden: true, customInspect: false });
    error =
      value instanceof Error
        ? {
            name: value.name,
            message: value.message,
            stack: value.stack,
            ...Object.fromEntries(Object.entries(value)),
            cause: raw(value.cause),
            raw: raw(value),
          }
        : { type: typeof value, raw: raw(value) };
  });
  const result = await new Promise<{ code: number | null; signal: ChildProcess["signalCode"] }>(
    (resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const receipt = {
    phase,
    command,
    args,
    cwd,
    pid: child.pid ?? null,
    startedAt,
    completedAt: new Date().toISOString(),
    budgetRemainingAtStartMs: remaining,
    ...result,
    error,
  };
  write(`${phase}-process.json`, receipt);
  return receipt;
}

async function assertStopped(phase: string): Promise<void> {
  const directory = path.join(root, phase);
  const records = fs.readdirSync(directory).filter((name) => /^server-\d+\.json$/.test(name));
  assert.ok(records.length > 0, "actual dev-server process identities are mandatory");
  for (const record of records) {
    const { detachedProcessGroup } = JSON.parse(
      fs.readFileSync(path.join(directory, record), "utf8"),
    );
    let alive = true;
    try {
      process.kill(-detachedProcessGroup, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      alive = false;
    }
    assert.equal(
      alive,
      false,
      "previous compiler/server must stop before swapping config or caches",
    );
  }
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: 5317 });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("Nuxt server port still open"));
    });
    socket.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
  write(`${phase}-server-stopped.json`, { records, processGroupsAbsent: true, portClosed: true });
}

const candidate = await run(
  "candidate",
  "vp",
  ["run", "--no-cache", "--filter", "./tests", "test:dev:nuxt-ui"],
  process.cwd(),
);
assert.equal(
  candidate.signal,
  null,
  "an interrupted original suite cannot start a reference phase",
);
assert.equal(candidate.error, undefined);
await assertStopped("candidate");
const { cwd } = JSON.parse(fs.readFileSync(path.join(root, "current-fixture.json"), "utf8"));
process.env.VIZE_NUXT_UI_COMPILER_PHASE = "candidate";
process.env.VIZE_NUXT_UI_COMPILER_AUTHORITY = root;
sealNuxtUiCandidate(cwd);
for (const [from, name] of [
  ["app/results", "results"],
  ["playwright-report", "report"],
  ["app/screenshots", "screenshots"],
]) {
  const source = path.join(tests, from!);
  if (fs.existsSync(source))
    fs.cpSync(source, path.join(root, "candidate", name!), { recursive: true });
}
const cli = createRequire(path.join(tests, "package.json")).resolve("@playwright/test/cli");
const reference = await run(
  "reference",
  process.execPath,
  [
    cli,
    "test",
    "--config",
    "app/playwright.config.ts",
    "app/dev/nuxt-ui.spec.ts",
    "--grep",
    "button page supports loading-auto",
    "--retries=0",
    "--reporter=list",
    "--output",
    path.join(root, "reference", "results"),
  ],
  tests,
);
await assertStopped("reference");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "candidate-identity.json"), "utf8"));
const after = fixtureIdentity(cwd);
write("reference-final-identity.json", after);
const generated = retainNuxtUiGeneratedOutput(
  cwd,
  path.join(root, "reference-generated-output"),
  after,
);
const moduleGraphs = verifyNuxtUiGeneratedOutputUnused(root, cwd);
write("generated-output-module-graph-admission.json", moduleGraphs);
const generatedDelta = compareNuxtUiAuthoredIdentity(baseline, after);
write("generated-output-delta.json", {
  schema: 1,
  producer: generated.producer,
  namespace: generated.namespace,
  before: baseline.source.filter((file: { path: string }) =>
    file.path.startsWith("playgrounds/vue/dist/"),
  ),
  after: generated.files,
  delta: generatedDelta,
});
const candidateConfig = fs.readFileSync(path.join(root, "candidate-config.ts"), "utf8");
const referenceConfig = fs.readFileSync(path.join(cwd, "playgrounds/nuxt/nuxt.config.ts"), "utf8");
assert.equal(referenceConfig, stockNuxtUiCompilerConfig(candidateConfig));
const transforms = summarizeNuxtUiTransforms(root, cwd);
const html = (["candidate", "reference"] as const).map((phase) => {
  const directory = path.join(root, phase);
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("html-button-"))
    .map((name) => path.join(directory, name, "normalized.html"));
  assert.ok(files.length > 0, `${phase} must retain the complete original button SSR response`);
  return {
    phase,
    files: files.map((file) => {
      const bytes = fs.readFileSync(file);
      return {
        file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  };
});
const referenceBodies = html.find((item) => item.phase === "reference")?.files;
assert.equal(referenceBodies?.length, 1, "new reference invocation has no retries");
const primaryHash = referenceBodies?.[0]?.sha256;
const wholeHtmlEqual = html.every((item) =>
  item.files.every((file) => file.sha256 === primaryHash),
);
write("paired-result.json", {
  candidate,
  reference,
  samePhysicalProvidersAndAuthoredSource: true,
  generatedOutput: { namespace: generated.namespace, delta: generatedDelta, moduleGraphs },
  actualSelectTransforms: transforms,
  wholeHtml: html,
  wholeHtmlEqual,
  configDifference: "public compiler: false only",
  referenceInvocations: 1,
  referenceRetries: 0,
  originalCandidateFailurePreserved: candidate.code !== 0,
  automaticGoldenAuthority: false,
});
process.exitCode =
  candidate.code !== 0 ||
  reference.code !== 0 ||
  reference.signal ||
  reference.error ||
  !wholeHtmlEqual
    ? 1
    : 0;
