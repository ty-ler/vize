import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
type Mode = { mode: string; status: number };
type Report = { diagnostics: unknown[]; number_of_files: number; number_of_rules: number };

const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const pick = (value: Json, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, value[key]]));
const lines = (file: string) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
// Owned temporary roots differ between any two runs; keep the path inside.
const relative = (file: string) => file.replace(/^.*\/(?=(?:packages|node_modules)\/)/u, "");

// Fields that are the same in any two complete qualifications of one staged
// binary. Process counts, PIDs, ledger digests, timings and owned temporary
// paths are run-specific and are reported, not compared.
const n8nKeys = [
  "source",
  "toolchain",
  "binarySha256",
  "fixture",
  "adoptionRevision",
  "requirementsConfigSha256",
  "projectedLayerSha256",
  "files",
  "packages",
  "scriptlessFiles",
  "disabledFiles",
  "totals",
  "limits",
];
const hostKeys = ["version", "files", "scriptless", "disabledFiles", "vectorSha256", "limits"];

// Slice rows of one mode collapse to one row with the highest status.
export function collapseModes(modes: readonly Mode[]): Mode[] {
  const rows: Mode[] = [];
  for (const { mode, status } of modes) {
    const last = rows.at(-1);
    if (last?.mode === mode) last.status = Math.max(last.status, status);
    else rows.push({ mode, status });
  }
  return rows;
}

function hostReports(directory: string) {
  const rows = read(path.join(directory, "host-results.json")) as Array<Json>;
  const reports: Record<string, Report> = {};
  for (const row of rows) {
    if (["effective", "effective-original"].includes(String(row.mode))) continue;
    const report = JSON.parse(String(row.stdout)) as Report;
    const joined = reports[String(row.mode)];
    reports[String(row.mode)] = joined
      ? {
          diagnostics: [...joined.diagnostics, ...report.diagnostics],
          number_of_files: joined.number_of_files + report.number_of_files,
          number_of_rules: report.number_of_rules,
        }
      : (pick(report, ["diagnostics", "number_of_files", "number_of_rules"]) as Report);
  }
  return reports;
}

export function compareQualifications(previous: string, current: string) {
  const differences: string[] = [];
  const same = (label: string, left: unknown, right: unknown) => {
    try {
      assert.deepEqual(right, left);
    } catch {
      differences.push(label);
    }
  };
  const [before, after] = [previous, current].map((root) =>
    read(path.join(root, "qualification.json")),
  );
  const project = (value: Json) => ({
    ...value,
    mixedDirectory8507: {
      ...(value.mixedDirectory8507 as Json),
      provider: {
        ...((value.mixedDirectory8507 as Json).provider as Json),
        engine: relative(String(((value.mixedDirectory8507 as Json).provider as Json).engine)),
      },
    },
  });
  same("qualification.json", project(before), project(after));
  const [n8nBefore, n8nAfter] = [previous, current].map((root) =>
    read(path.join(root, "n8n/qualification.json")),
  );
  same("n8n/qualification.json", pick(n8nBefore, n8nKeys), pick(n8nAfter, n8nKeys));
  same(
    "n8n reference source",
    pick(n8nBefore.reference, ["source", "physicalSource", "bundles", "limits"]),
    pick(n8nAfter.reference, ["source", "physicalSource", "bundles", "limits"]),
  );
  for (const [index, host] of (n8nBefore.hosts as Json[]).entries()) {
    const other = (n8nAfter.hosts as Json[])[index] ?? {};
    const version = String(host.version);
    same(`host ${version}`, pick(host, hostKeys), pick(other, hostKeys));
    same(
      `host ${version} mode statuses`,
      collapseModes(host.modes as Mode[]),
      collapseModes((other.modes as Mode[]) ?? []),
    );
    const directory = (root: string) => path.join(root, "n8n", version);
    const [reportsBefore, reportsAfter] = [previous, current].map((root) =>
      hostReports(directory(root)),
    );
    same(`host ${version} reports`, reportsBefore, reportsAfter);
  }
  const vectors = (root: string) =>
    lines(path.join(root, "n8n/bridge/bridge-vectors.jsonl")).map(
      ({ elapsedMs: _elapsedMs, ...row }) => row,
    );
  same("n8n bridge vectors", vectors(previous), vectors(current));
  // Each control row names a file in that run's owned temporary directory.
  const controls = (root: string) =>
    lines(path.join(root, "n8n/bridge/cache-controls.jsonl")).map((row) =>
      JSON.parse(JSON.stringify(row).split(path.dirname(row.filename)).join("<owned>")),
    );
  same("n8n cache controls", controls(previous), controls(current));
  const processTopology = (root: string) => {
    const n8n = read(path.join(root, "n8n/qualification.json"));
    const timing = read(path.join(root, "phase-walltime.json"));
    return {
      processes: n8n.processes,
      events: n8n.events,
      phaseWalltimeMs: timing.phaseWalltimeMs,
      hosts: timing.hosts.map((host: Json) => pick(host, ["version", "phaseWalltimeMs"])),
    };
  };
  return {
    schema: "vize.oxlint.qualification-parallelism-comparison",
    version: 1,
    equal: differences.length === 0,
    differences,
    previous: processTopology(previous),
    current: processTopology(current),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [previous, current, output, ...rest] = process.argv.slice(2);
  assert.ok(previous && current && output && rest.length === 0, "usage: PREVIOUS CURRENT OUTPUT");
  const comparison = compareQualifications(previous, current);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(comparison, null, 2) + "\n");
  process.stdout.write(JSON.stringify(comparison, null, 2) + "\n");
  process.exitCode = comparison.equal ? 0 : 1;
}
