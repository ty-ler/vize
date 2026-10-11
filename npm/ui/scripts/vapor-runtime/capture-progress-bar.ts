/**
 * Private, compile-only diagnosis of the four ProgressBar hydration failures.
 * Never evaluate generated modules or substitute this capture for conformance.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BEFORE = "588d2c29ceead01ca391ab10eaf59439c8619798";
const SOURCE = "7248841970a7f6385d33649282d59129259bcc7e";
const ORIGINAL_CHECKOUT = "951e4b339fc8417c8d29931f71b0dfbb8b63a5fa";
const ORIGINAL_JOB = 114355854045;
const ORIGINAL_LOG_SHA256 = "daa4d921c426a8299d8e25db19763ab1c930862a5f8d7c583a17e9fe3cbd4ce8";
const ORIGINAL_FILENAME =
  "/home/runner/_work/vize/vize/npm/ui/src/families/feedback/progress-bar/progress-bar.vue";
const COMPONENT = "npm/ui/src/families/feedback/progress-bar/progress-bar.vue";
const STATE = "npm/ui/src/families/feedback/progress-bar/progress-bar-state.ts";
const FIXTURES =
  "npm/ui/src/families/feedback/progress-bar/runtime-conformance-progress-bar-fixtures.ts";
const HOOKS = "npm/ui/scripts/vapor-runtime/sfc-hooks.ts";
const OWNED = [
  ".github/workflows/check.yml",
  "npm/ui/scripts/vapor-runtime/capture-progress-bar.ts",
];
export const TEXT_CAP = 4 * 1024 * 1024;
export const PROOF_CAP = 1024 * 1024;

interface Payload {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Reject duplicate or extra transport types, invalid text, and unbounded output. */
export function validatePayloads(payloads: readonly Payload[]): { text: number; proof: number } {
  if (payloads.length === 0 || payloads.length > 64)
    throw new Error("Empty or excessive capture file set");
  const seen = new Set<string>();
  const totals = { text: 0, proof: 0 };
  for (const payload of payloads) {
    if (!/^(text\/[a-z0-9-]+\.txt|proof\/[a-z0-9-]+\.json)$/.test(payload.name)) {
      throw new Error(`Forbidden capture filename: ${payload.name}`);
    }
    if (seen.has(payload.name)) throw new Error(`Duplicate capture filename: ${payload.name}`);
    seen.add(payload.name);
    const content = new TextDecoder("utf8", { fatal: true }).decode(payload.bytes);
    if (content.includes("\0")) throw new Error(`Binary capture content: ${payload.name}`);
    if (payload.name.startsWith("proof/")) {
      JSON.parse(content);
      totals.proof += payload.bytes.byteLength;
    } else {
      totals.text += payload.bytes.byteLength;
    }
  }
  if (totals.text > TEXT_CAP || totals.proof > PROOF_CAP) {
    throw new Error(`Capture exceeds complete-output caps: ${JSON.stringify(totals)}`);
  }
  return totals;
}

const require = createRequire(new URL("./sfc-hooks.ts", import.meta.url));
const compileFailures: string[] = [];

// This complete adapter body is copied byte-for-byte from the original hooks.
function compileWithVue(source: string, filename: string): string {
  const compiler = require("vue-vapor-runtime/compiler-sfc") as typeof import("vue/compiler-sfc");
  const { descriptor, errors } = compiler.parse(source, { filename });
  if (errors.length > 0) compileFailures.push(`${filename} [vue]\n${errors.join("\n")}`);
  const scoped = descriptor.styles.some((style) => style.scoped);
  const id = createHash("sha256").update(filename).digest("hex").slice(0, 8);
  const script = compiler.compileScript(descriptor, {
    id,
    inlineTemplate: true,
    isProd: false,
    templateOptions: { scoped },
    vapor: true,
  } as Parameters<typeof compiler.compileScript>[1]);
  return script.content;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(root: string, args: readonly string[]): Buffer {
  return execFileSync("git", ["--no-replace-objects", "-C", root, ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

function fileIdentity(path: string): object {
  const bytes = readFileSync(path);
  return { path: realpathSync(path), bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function tree(root: string, head: string): Map<string, string> {
  const entries = git(root, ["ls-tree", "-rz", "--full-tree", head]).toString("utf8").split("\0");
  return new Map(
    entries.filter(Boolean).map((entry) => {
      const split = entry.indexOf("\t");
      return [entry.slice(split + 1), entry.slice(0, split)];
    }),
  );
}

function sameForeignTree(root: string, head: string): object {
  const current = tree(root, head);
  const original = tree(root, SOURCE);
  for (const owned of OWNED) {
    current.delete(owned);
    original.delete(owned);
  }
  const serialize = (entries: Map<string, string>): string =>
    JSON.stringify([...entries].sort(([left], [right]) => left.localeCompare(right)));
  if (serialize(current) !== serialize(original)) {
    throw new Error("A normal source, fixture, cap, ledger, or producer differs from frozen H724");
  }
  const worktreeChanges = git(root, ["diff", "--name-only", "HEAD"]).toString("utf8").trim();
  if (worktreeChanges !== "") throw new Error(`Tracked source is dirty: ${worktreeChanges}`);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"])
    .toString("utf8")
    .trim();
  if (untracked !== "") throw new Error(`Untracked source is present: ${untracked}`);
  const oldToNew = git(root, ["diff", "--name-only", BEFORE, SOURCE])
    .toString("utf8")
    .trim()
    .split("\n");
  if (oldToNew.some((path) => !path.startsWith("npm/ui/") && !path.startsWith("docs/"))) {
    throw new Error("Compiler/build/provider source differs between the old and current UI inputs");
  }
  const ancestry = git(root, ["rev-list", "--parents", "-n", "1", head]).toString("utf8").trim();
  if (ancestry !== `${head} ${SOURCE}`)
    throw new Error("Private capture is not a sole-parent H724 diagnostic");
  return {
    source: SOURCE,
    sourceTree: git(root, ["rev-parse", `${SOURCE}^{tree}`])
      .toString("utf8")
      .trim(),
    capture: head,
    captureTree: git(root, ["rev-parse", `${head}^{tree}`])
      .toString("utf8")
      .trim(),
    soleParent: ancestry,
    excludedDiagnosticPaths: OWNED,
    unchangedModeObjectCount: current.size,
    unchangedModeObjectSha256: sha256(serialize(current)),
    beforeToCurrentChangedPaths: oldToNew,
  };
}

/** Only the reviewed hosted command reaches native or compiler provider loading. */
async function capture(output: string): Promise<void> {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  ) {
    throw new Error("Compile capture is restricted to the reviewed hosted workflow_dispatch route");
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Expected the original hosted Linux x64 producer platform");
  }
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH || process.env.NAPI_RS_FORCE_WASI) {
    throw new Error("Native provider overrides are forbidden for this same-source capture");
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const head = git(root, ["rev-parse", "HEAD"]).toString("utf8").trim();
  if (head !== process.env.GITHUB_SHA)
    throw new Error("Checkout HEAD does not match workflow source");
  const sourceProof = sameForeignTree(root, head);
  const target = resolve(output);
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP ?? "");
  const targetRelative = relative(runnerTemp, target);
  if (isAbsolute(targetRelative) || targetRelative === "" || targetRelative.startsWith("..")) {
    throw new Error("Capture output must be a fresh directory inside RUNNER_TEMP");
  }
  const payloads: Payload[] = [];
  const text = (name: string, content: string): void => {
    payloads.push({ name: `text/${name}.txt`, bytes: Buffer.from(content) });
  };
  const proof = (name: string, content: unknown): void => {
    payloads.push({
      name: `proof/${name}.json`,
      bytes: Buffer.from(`${JSON.stringify(content, null, 2)}\n`),
    });
  };
  const sources = [
    { name: "before", commit: BEFORE },
    { name: "current", commit: SOURCE },
  ].map(({ name, commit }) => {
    const source = git(root, ["show", `${commit}:${COMPONENT}`]).toString("utf8");
    text(`${name}-progress-bar-source`, source);
    text(`${name}-progress-bar-state`, git(root, ["show", `${commit}:${STATE}`]).toString("utf8"));
    text(
      `${name}-progress-bar-fixtures`,
      git(root, ["show", `${commit}:${FIXTURES}`]).toString("utf8"),
    );
    return { name, commit, source, sourceSha256: sha256(source) };
  });
  if (sources[1].source !== readFileSync(join(root, COMPONENT), "utf8")) {
    throw new Error("Current component bytes differ from frozen H724 input");
  }
  const hooks = readFileSync(join(root, HOOKS), "utf8");
  const adapter = hooks.slice(
    hooks.indexOf("function compileWithVue("),
    hooks.indexOf("\n\n/** Install") + 2,
  );
  if (sha256(adapter) !== "8259f0d2f5869fe5b643b59b4a302d006c18e3f2152aeee842aa8776e2ce53c5") {
    throw new Error("Original reference adapter is not the reviewed complete function body");
  }
  text("original-sfc-hooks", hooks);
  text("capture-script", readFileSync(fileURLToPath(import.meta.url), "utf8"));
  text("capture-workflow", readFileSync(join(root, OWNED[0]), "utf8"));
  const packages = ["@vizejs/native", "vue-vapor-runtime", "vue", "vue/server-renderer"].map(
    (specifier) => {
      const publicEntrypoint = require.resolve(specifier);
      const providerRequire =
        specifier === "vue/server-renderer" ? createRequire(publicEntrypoint) : require;
      const providerSpecifier =
        specifier === "vue/server-renderer" ? "@vue/server-renderer" : specifier;
      const packageFile = providerRequire.resolve(`${providerSpecifier}/package.json`);
      const data = JSON.parse(readFileSync(packageFile, "utf8")) as {
        name: string;
        version: string;
      };
      return {
        specifier,
        name: data.name,
        version: data.version,
        package: fileIdentity(packageFile),
        publicEntrypoint: fileIdentity(publicEntrypoint),
        entrypoint: fileIdentity(providerRequire.resolve(providerSpecifier)),
      };
    },
  );
  const reference = packages.find((item) => item.specifier === "vue-vapor-runtime");
  if (reference?.version !== "3.6.0-rc.9")
    throw new Error("Reference alias is not the original exact RC9 provider");
  const sourceNativeVersion = (
    JSON.parse(readFileSync(join(root, "npm/native/package.json"), "utf8")) as { version: string }
  ).version;
  if (
    packages.find((item) => item.specifier === "@vizejs/native")?.version !== sourceNativeVersion
  ) {
    throw new Error("Loaded native package version differs from the frozen source manifest");
  }
  if (
    packages.find((item) => item.specifier === "vue")?.version !== "3.5.42" ||
    packages.find((item) => item.specifier === "vue/server-renderer")?.version !== "3.5.42"
  ) {
    throw new Error(
      "Production Vue and server renderer differ from the original source-locked 3.5.42 pair",
    );
  }
  const compilerFile = require.resolve("vue-vapor-runtime/compiler-sfc");
  const runtimeFile =
    require.resolve("vue-vapor-runtime/dist/vue.runtime-with-vapor.esm-browser.js");
  const compiler = require("vue-vapor-runtime/compiler-sfc") as { version: string };
  if (compiler.version !== "3.6.0-rc.9")
    throw new Error("Loaded reference compiler is not exact RC9");
  const entrypoint = realpathSync(require.resolve("@vizejs/native"));
  if (entrypoint !== realpathSync(join(root, "npm/native/index.js"))) {
    throw new Error("Native module did not resolve to the hosted source build entrypoint");
  }
  const native = require("@vizejs/native") as typeof import("@vizejs/native");
  const binaries = Object.keys(require.cache).filter((path) => path.endsWith(".node"));
  if (
    binaries.length !== 1 ||
    dirname(realpathSync(binaries[0])) !== realpathSync(join(root, "npm/native"))
  ) {
    throw new Error(
      "Capture must use exactly one locally built native binary, never a registry fallback",
    );
  }
  const nativeResults: object[] = [];
  const compilationProblems: string[] = [];
  for (const input of sources) {
    for (const lane of ["ssr", "vapor"] as const) {
      const options = {
        filename: ORIGINAL_FILENAME,
        isTs: true,
        mode: "module" as const,
        ssr: lane === "ssr",
        vapor: lane === "vapor",
      };
      try {
        const result = native.compileSfc(input.source, options);
        text(`${input.name}-native-${lane}-raw`, result.code);
        text(
          `${input.name}-native-${lane}-loaded`,
          result.code.replaceAll('"@vue/server-renderer"', '"vue/server-renderer"'),
        );
        const { code: _code, ...metadata } = result;
        nativeResults.push({ name: input.name, commit: input.commit, lane, options, metadata });
        if (result.errors.length > 0)
          compilationProblems.push(`${input.name} [${lane}]: ${result.errors.join("\n")}`);
      } catch (error) {
        const problem = error instanceof Error ? (error.stack ?? error.message) : String(error);
        compilationProblems.push(`${input.name} [${lane}]: ${problem}`);
        nativeResults.push({
          name: input.name,
          commit: input.commit,
          lane,
          options,
          exception: problem,
        });
      }
    }
    try {
      text(`${input.name}-reference-vapor`, compileWithVue(input.source, ORIGINAL_FILENAME));
    } catch (error) {
      compilationProblems.push(
        `${input.name} [vue]: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    }
  }

  proof("source-and-options", {
    claim:
      "Compile-only recapture; no emitted-module evaluation, SSR/DOM/browser execution, conformance, queue, merge, or release credit.",
    originalNativeOutputCustody:
      "Absent: the original hosted hooks compiled in memory without retaining emitted output.",
    original: {
      checkout: ORIGINAL_CHECKOUT,
      job: ORIGINAL_JOB,
      wholeLogSha256: ORIGINAL_LOG_SHA256,
    },
    sourceProof,
    filename: ORIGINAL_FILENAME,
    inputs: sources.map(({ source: _source, ...input }) => input),
    referenceAdapterSha256: sha256(adapter),
    referenceOptions: {
      id: sha256(ORIGINAL_FILENAME).slice(0, 8),
      inlineTemplate: true,
      isProd: false,
      templateOptions: { scoped: true },
      vapor: true,
    },
    nativeResults,
    compilationProblems: [...compilationProblems, ...compileFailures],
    run: {
      id: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
      workflow: process.env.GITHUB_WORKFLOW,
    },
  });
  proof("provider-identity", {
    node: {
      version: process.version,
      abi: process.versions.modules,
      napi: process.versions.napi,
      platform: process.platform,
      arch: process.arch,
      executable: fileIdentity(process.execPath),
    },
    packages,
    nativeBuildCommand: ["vp", "run", "--filter", "./npm/native", "build:ci"],
    toolchain: {
      rustc: execFileSync("rustc", ["-Vv"], { encoding: "utf8" }),
      cargo: execFileSync("cargo", ["-V"], { encoding: "utf8" }),
      lockfiles: ["Cargo.lock", "pnpm-lock.yaml"].map((path) => fileIdentity(join(root, path))),
    },
    nativeBinary: fileIdentity(binaries[0]),
    referenceCompiler: { version: compiler.version, entrypoint: fileIdentity(compilerFile) },
    referenceRuntime: { evaluated: false, entrypoint: fileIdentity(runtimeFile) },
    loadedCommonJsSources: Object.keys(require.cache).sort().map(fileIdentity),
  });
  proof("manifest", {
    caps: { text: TEXT_CAP, proof: PROOF_CAP },
    files: payloads.map(({ name, bytes }) => ({
      name,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })),
    completion:
      "All complete outputs available from each successful compilation; exceptions are preserved without truncation.",
    executableOrBinaryPayloads: false,
  });
  const totals = validatePayloads(payloads);
  mkdirSync(target);
  mkdirSync(join(target, "text"));
  mkdirSync(join(target, "proof"));
  for (const payload of payloads)
    writeFileSync(join(target, payload.name), payload.bytes, { mode: 0o644, flag: "wx" });
  if (JSON.stringify(readdirSync(target).sort()) !== JSON.stringify(["proof", "text"])) {
    throw new Error("Capture output has extra top-level entries");
  }
  const actualNames = ["text", "proof"]
    .flatMap((group) => readdirSync(join(target, group)).map((name) => `${group}/${name}`))
    .sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(payloads.map(({ name }) => name).sort())) {
    throw new Error("Capture output file set is incomplete or has extras");
  }
  const onDisk = actualNames.map((name) => {
    const path = join(target, name);
    if (!lstatSync(path).isFile() || (lstatSync(path).mode & 0o111) !== 0)
      throw new Error(`Executable or non-file capture payload: ${name}`);
    return { name, bytes: readFileSync(path) };
  });
  if (JSON.stringify(validatePayloads(onDisk)) !== JSON.stringify(totals))
    throw new Error("Capture transport totals changed");
  if (
    onDisk.some(
      (item, index) =>
        sha256(item.bytes) !==
        sha256([...payloads].sort((a, b) => a.name.localeCompare(b.name))[index].bytes),
    )
  ) {
    throw new Error("Complete capture bytes changed on disk");
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "complete=true\n");
  console.log(JSON.stringify({ diagnosticOnly: true, head, totals, files: payloads.length }));
  if (compilationProblems.length > 0 || compileFailures.length > 0) {
    throw new Error("Compilation problems retained in complete diagnostic proof");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3)
    throw new Error("Usage: node capture-progress-bar.ts <fresh-RUNNER_TEMP-directory>");
  await capture(process.argv[2]);
}
