import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Selected experiment inputs, never a replacement baseline or acceptance run.
export const selectedSources = {
  parent: "da26dc4b2bb9f02492f8682929d29c4dfc1f7ec9",
  candidate: "1eec5d48ee418b4d55cc78d029648735ebc52d5a",
} as const;

type Role = keyof typeof selectedSources;
type Identity = { commit: string; tree: string; parents: string[] };
type Context = {
  actor: Identity;
  workspace: string;
  runnerTemp: string;
  selectedSources: Record<Role, string>;
};

export function validateDiagnosticContext(context: Context, event: string, fresh: string) {
  assert.equal(event, "workflow_dispatch", "paired diagnostics require explicit dispatch");
  assert.equal(fresh, "1", "both lanes must use the original harness rebuild protocol");
  assert.deepEqual(context.selectedSources, selectedSources);
  assert.match(context.actor.commit, /^[a-f0-9]{40}$/);
  assert.match(context.actor.tree, /^[a-f0-9]{40}$/);
  assert.ok(!Object.values(selectedSources).some((ref) => ref === context.actor.commit));
  assert.ok(path.isAbsolute(context.workspace));
  assert.ok(path.isAbsolute(context.runnerTemp));
  assert.notEqual(context.workspace, context.runnerTemp);
}

function run(executable: string, args: string[], root: string, output?: string) {
  const child = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: process.env,
  });
  if (output) {
    fs.writeFileSync(`${output}.stdout`, child.stdout ?? "");
    fs.writeFileSync(`${output}.stderr`, child.stderr ?? "");
    writeJson(`${output}.json`, {
      executable,
      args,
      cwd: root,
      status: child.status,
      signal: child.signal,
      error: child.error?.message,
    });
  }
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, `${executable}: ${child.stderr}`);
  return child.stdout.trim();
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function identity(workspace: string): Identity {
  return {
    commit: run("git", ["rev-parse", "HEAD"], workspace),
    tree: run("git", ["rev-parse", "HEAD^{tree}"], workspace),
    parents: run("git", ["cat-file", "-p", "HEAD"], workspace)
      .split("\n")
      .filter((line) => line.startsWith("parent "))
      .map((line) => line.slice(7)),
  };
}

function hash(file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshot(context: Context, role: Role, directory: string) {
  const current = identity(context.workspace);
  assert.equal(current.commit, selectedSources[role]);
  assert.equal(run("git", ["status", "--porcelain=v1"], context.workspace), "");
  const measurement = path.join(context.runnerTemp, "instruction-counts");
  const report = JSON.parse(fs.readFileSync(path.join(measurement, "measurement.json"), "utf8"));
  assert.equal(report.source_commit, current.commit);
  assert.equal(report.runs.length, 3);
  assert.ok(report.runs.every((rows: object) => Object.keys(rows).length === 100));
  const binaries: { pkg: string; bench: string; fresh: boolean; sha256: string }[] = JSON.parse(
    fs.readFileSync(path.join(measurement, "binaries.json"), "utf8"),
  );
  const indexes = binaries.flatMap((row, index) =>
    row.pkg === "vize_atelier_vapor" && row.bench === "davinci" ? [index] : [],
  );
  assert.equal(indexes.length, 1);
  const index = indexes[0];
  assert.notEqual(index, undefined);
  const binary = binaries[index];
  assert.ok(binary);
  assert.equal(binary.fresh, false, "the selected producer must be freshly rebuilt");
  const probe = path.join(
    context.runnerTemp,
    "instruction-probes",
    `probe-${String(index).padStart(2, "0")}`,
  );
  assert.ok(fs.lstatSync(probe).isSymbolicLink());
  const executable = path.join(directory, "vapor-davinci");
  fs.copyFileSync(probe, executable);
  assert.equal(hash(executable), binary.sha256);
  run("objdump", ["-d", "-C", executable], context.workspace, path.join(directory, "objdump"));
  run("readelf", ["-aW", executable], context.workspace, path.join(directory, "readelf"));
  run("git", ["ls-tree", "-r", "HEAD"], context.workspace, path.join(directory, "source-tree"));
  run(
    "git",
    ["show", "--format=fuller", "--no-patch", "HEAD"],
    context.workspace,
    path.join(directory, "source-commit"),
  );
  for (const source of [
    "crates/vize_atelier_vapor/src/l3/native/validate.rs",
    "crates/vize_atelier_vapor/src/l3/native.rs",
    "crates/vize_atelier_vapor/src/generate/operations/for_loop.rs",
    "tools/benchmarks/scripts/instruction-counts.mjs",
    "docs/davinci/plan/instruction-budgets.toml",
    "Cargo.lock",
  ]) {
    const destination = path.join(directory, "source", source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(context.workspace, source), destination);
  }
  writeJson(path.join(directory, "identity.json"), {
    role,
    source: current,
    actor: context.actor,
    executableSha256: binary.sha256,
    originalCollect: { freshHarness: "1", output: measurement, probe },
    rawDisassemblyOnly: true,
    acceptance: false,
  });
}

function cleanProbeLinks(context: Context) {
  const probes = path.join(context.runnerTemp, "instruction-probes");
  for (const name of fs.readdirSync(probes)) {
    assert.match(name, /^probe-\d+$/);
    const file = path.join(probes, name);
    assert.ok(fs.lstatSync(file).isSymbolicLink());
    fs.unlinkSync(file);
  }
  fs.rmdirSync(probes);
}

function main() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "native diagnostic runs only in Actions");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  const [phase] = process.argv.slice(2);
  assert.ok(["before", "after", "restore"].includes(phase ?? ""));
  const workspace = process.env.GITHUB_WORKSPACE;
  const runnerTemp = process.env.RUNNER_TEMP;
  assert.ok(workspace && runnerTemp);
  const evidence = path.join(runnerTemp, "instruction-paired-diagnostic");
  const contextFile = path.join(evidence, "actor.json");
  if (phase === "before") {
    assert.equal(fs.existsSync(evidence), false, "never reuse diagnostic evidence");
    const context: Context = { actor: identity(workspace), workspace, runnerTemp, selectedSources };
    validateDiagnosticContext(
      context,
      process.env.GITHUB_EVENT_NAME ?? "",
      process.env.VIZE_INSTRUCTION_REBUILD ?? "",
    );
    assert.equal(run("git", ["status", "--porcelain=v1"], workspace), "");
    fs.mkdirSync(evidence);
    writeJson(contextFile, context);
    const actorScript = process.argv[1];
    assert.ok(actorScript);
    writeJson(path.join(evidence, "actor-code.json"), {
      source: context.actor,
      sha256: hash(actorScript),
      selectedSources,
    });
    for (const ref of Object.values(selectedSources))
      run("git", ["fetch", "--no-tags", "--depth=2", "origin", ref], workspace);
    assert.ok(
      run("git", ["cat-file", "-p", selectedSources.candidate], workspace)
        .split("\n")
        .includes(`parent ${selectedSources.parent}`),
    );
    assert.deepEqual(
      run(
        "git",
        ["diff", "--name-only", selectedSources.parent, selectedSources.candidate],
        workspace,
      ).split("\n"),
      [
        "crates/vize_atelier_sfc/tests/vapor_runtime_contracts.rs",
        "crates/vize_atelier_vapor/src/generate/operations/for_loop.rs",
        "tests/tooling/support/vapor-sfc-runtime.mjs",
        "tests/tooling/support/vapor-unicode-key-scope.ts",
      ],
    );
    const budgetPath = "docs/davinci/plan/instruction-budgets.toml";
    const actorBudget = run(
      "git",
      ["rev-parse", `${context.actor.commit}:${budgetPath}`],
      workspace,
    );
    for (const ref of Object.values(selectedSources))
      assert.equal(run("git", ["rev-parse", `${ref}:${budgetPath}`], workspace), actorBudget);
    const immutableBudgets = path.join(evidence, "immutable-input-budgets.toml");
    fs.copyFileSync(path.join(workspace, budgetPath), immutableBudgets);
    const parentDirectory = path.join(evidence, "parent");
    fs.mkdirSync(parentDirectory);
    run("git", ["checkout", "--detach", selectedSources.parent], workspace);
    run(
      process.execPath,
      [
        "tools/benchmarks/scripts/instruction-counts.mjs",
        "--collect",
        "--out",
        path.join(runnerTemp, "instruction-counts"),
      ],
      workspace,
      path.join(parentDirectory, "collect"),
    );
    snapshot(context, "parent", parentDirectory);
    // These run the original committed caps and original verifier, never a derived cap.
    run(
      process.execPath,
      [
        "tools/benchmarks/scripts/instruction-counts.mjs",
        "--verify-budgets",
        "--base-budgets",
        immutableBudgets,
      ],
      workspace,
      path.join(parentDirectory, "ratchet"),
    );
    run(
      process.execPath,
      [
        "tools/benchmarks/scripts/instruction-counts.mjs",
        "--check",
        "--measurement",
        path.join(runnerTemp, "instruction-counts", "measurement.json"),
        "--base-budgets",
        immutableBudgets,
      ],
      workspace,
      path.join(parentDirectory, "ceilings"),
    );
    fs.renameSync(
      path.join(runnerTemp, "instruction-counts"),
      path.join(parentDirectory, "measurement"),
    );
    cleanProbeLinks(context);
    run("git", ["checkout", "--detach", selectedSources.candidate], workspace);
  } else {
    const context: Context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    validateDiagnosticContext(
      context,
      process.env.GITHUB_EVENT_NAME ?? "",
      process.env.VIZE_INSTRUCTION_REBUILD ?? "",
    );
    assert.equal(context.workspace, workspace);
    assert.equal(context.runnerTemp, runnerTemp);
    if (phase === "after") {
      const candidateDirectory = path.join(evidence, "candidate");
      fs.mkdirSync(candidateDirectory);
      snapshot(context, "candidate", candidateDirectory);
      fs.cpSync(
        path.join(runnerTemp, "instruction-counts"),
        path.join(candidateDirectory, "measurement"),
        { recursive: true, errorOnExist: true, force: false },
      );
    } else {
      assert.equal(run("git", ["status", "--porcelain=v1"], workspace), "");
      run("git", ["checkout", "--detach", context.actor.commit], workspace);
      assert.deepEqual(identity(workspace), context.actor);
    }
  }
}

if (import.meta.main) main();
