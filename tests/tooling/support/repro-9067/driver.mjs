// #9067 repro (temporary branch only): spawn the patterned-template runtime
// child many times, with the runtime bundled in each child through vite-plus
// (baseline) and bundled once here (prebundled), and count teardown crashes.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { vueVaporRuntimeEntry } from "../vue-vapor-release.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const inputs = readFileSync(path.join(here, "inputs.jsonl"), "utf8").trim().split("\n");
const rounds = Number(process.env.REPRO_ROUNDS ?? 5);
const concurrency = Number(process.env.REPRO_CONCURRENCY ?? 32);

const result = await build({
  configFile: false,
  logLevel: "silent",
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "true",
  },
  build: { write: false, minify: false, lib: { entry: vueVaporRuntimeEntry, formats: ["es"] } },
});
const chunk = (Array.isArray(result) ? result : [result])
  .flatMap((output) => output.output)
  .find((item) => item.type === "chunk");
const bundle = path.join(mkdtempSync(path.join(tmpdir(), "repro-9067-")), "vue.mjs");
writeFileSync(bundle, chunk.code);

function run(runner, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner], {
      env: { ...process.env, REPRO_9067_RUNTIME_BUNDLE: bundle },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

const variants = {
  baseline: path.join(here, "..", "patterned-template-runtime.mjs"),
  prebundled: path.join(here, "runner-prebundled.mjs"),
};
const order = (process.env.REPRO_VARIANTS ?? "baseline,prebundled").split(",");
const summary = {};
for (const name of order) {
  const jobs = [];
  for (let round = 0; round < rounds; round++) for (const input of inputs) jobs.push(input);
  const stats = { runs: 0, passed: 0, crashedAfterPass: 0, otherFailures: 0, signals: {}, backends: {} };
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const input = jobs[next++];
        const { backend, cases } = JSON.parse(input);
        const outcome = await run(variants[name], input);
        stats.runs++;
        const passedPayload = outcome.stdout === JSON.stringify({ passed: cases.length });
        if (outcome.code === 0 && passedPayload) stats.passed++;
        else if (outcome.signal && passedPayload) {
          stats.crashedAfterPass++;
          stats.backends[backend] = (stats.backends[backend] ?? 0) + 1;
        } else {
          stats.otherFailures++;
          if (stats.otherFailures <= 3) console.error(name, backend, outcome.code, outcome.signal, outcome.stderr.slice(0, 2000));
        }
        if (outcome.signal) stats.signals[outcome.signal] = (stats.signals[outcome.signal] ?? 0) + 1;
      }
    }),
  );
  summary[name] = stats;
  console.log(JSON.stringify({ variant: name, ...stats }));
}
writeFileSync(process.env.REPRO_SUMMARY ?? path.join(tmpdir(), "repro-9067.json"), JSON.stringify(summary));
