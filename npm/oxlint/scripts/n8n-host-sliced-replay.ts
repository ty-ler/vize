import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { seedOriginalSources } from "./n8n-baseline-partitions.mjs";
import {
  assertEffectiveOriginal,
  assertEffectiveRefusal,
  assertModeRun,
  hostModeHangGuardMs,
  hostWrapper,
  judgeHostReports,
  judgeModeReport,
  materializeOriginal,
  modeInvocation,
  writeHostSummary,
} from "./n8n-host-replay.mjs";
import { mergeSliceReports, referenceSlices } from "./n8n-host-slices.ts";
import type { HostReport, HostSlice } from "./n8n-host-slices.ts";
import { captureProjectCommand } from "./project-command-capture.mjs";
import { sha256, verifyCorpus } from "./n8n-replay-inputs.mjs";

type Custody = { calls: string; sources: string } & Record<string, unknown>;
type Result = { status: number | null; stdout: string } & Record<string, unknown>;
type Row = { mode: string; status: number | null } & Record<string, unknown>;
type Reference = { plugin: string; wrapper: string } & Record<string, unknown>;

const temporaryRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "vize-n8n-original-project-"));

// The serial host phase order; the joined host ledger keeps it.
const ledgerKeys = (count: number) => [
  "stock",
  ...Array.from({ length: count }, (_, index) => `reference-${index}`),
  "baseline",
  "shared",
  "effective",
  "effective-original",
];

// The same host modes as qualifyN8nHost against the same staged binary. The
// unhinted reference mode runs as fixed slices of the ordered inventory, each
// a complete original project of its own, while the other modes run in order
// in one whole-project root. Every whole-project comparison then checks the
// joined reference report against the unsliced baseline report.
export async function qualifyN8nHostSliced(
  engine: string,
  version: string,
  output: string,
  custody: Custody,
  environment: Record<string, string>,
  reference: Reference,
  count: number,
  {
    verify = verifyCorpus,
    wrapper = hostWrapper,
  }: { verify?: typeof verifyCorpus; wrapper?: string } = {},
) {
  const inventory = verify();
  const files: string[] = inventory.files.map(({ file }: { file: string }) => file);
  const slices: HostSlice[] = referenceSlices(files, count);
  // Concurrent recorders only read the complete original backing bytes.
  seedOriginalSources(inventory, custody.sources);
  const original = temporaryRoot();
  const roots = slices.map(() => temporaryRoot());
  const rows = new Map<string, Row>();
  const capture = () =>
    ledgerKeys(count).flatMap((key) => {
      const row = rows.get(key);
      return row ? [row] : [];
    });
  const capturePath = path.join(output, "host-results.json");
  fs.mkdirSync(output, { recursive: true });
  const save = () => fs.writeFileSync(capturePath, JSON.stringify(capture(), null, 2) + "\n");
  const ledgers = new Map<string, string>();
  const run = (key: string, phase: string, args: string[], cwd: string) => {
    // Each process appends to its own ledger; no two writers share a file.
    const directory = path.join(output, "ledgers", key);
    fs.mkdirSync(directory, { recursive: true });
    const calls = path.join(directory, "native-calls.jsonl");
    const configuration = path.join(directory, "custody.json");
    fs.writeFileSync(configuration, JSON.stringify({ ...custody, calls }, null, 2) + "\n");
    ledgers.set(key, calls);
    return captureProjectCommand(process.execPath, args, {
      cwd,
      encoding: "utf8",
      timeout: hostModeHangGuardMs,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        ...environment,
        VIZE_N8N_NATIVE_CUSTODY: configuration,
        VIZE_N8N_REPLAY_PHASE: `host:${version}:${phase}`,
      },
    }) as Promise<Result>;
  };
  const row = (mode: string, cwd: string, args: string[], bytes: string, started: number) => ({
    mode,
    engine,
    version,
    cwd,
    args,
    configBytes: bytes,
    configSha256: sha256(bytes),
    elapsedMs: performance.now() - started,
  });
  try {
    materializeOriginal(original, engine, inventory);
    for (const [index, { start, end }] of slices.entries())
      materializeOriginal(roots[index], engine, inventory, inventory.files.slice(start, end));
    const reports: Record<string, HostReport> = {};
    const statuses: Record<string, number | null> = {};
    const sequence = async () => {
      for (const mode of ["stock", "baseline", "shared", "effective"]) {
        const invocation = modeInvocation(mode, {
          engine,
          reference,
          root: original,
          output,
          wrapper,
        });
        const started = performance.now();
        const result = await run(mode, mode, invocation.args, original);
        rows.set(mode, {
          ...row(mode, original, invocation.args, invocation.bytes, started),
          ...result,
        });
        save(); // Preserve complete output/status/errors before any assertion.
        assertModeRun(result, invocation.configPath, invocation.bytes);
        statuses[mode] = result.status;
        if (mode === "effective") {
          assertEffectiveRefusal(result);
          const args = [engine, ...invocation.args.slice(1)];
          const originalStarted = performance.now();
          const originalResult = await run(
            "effective-original",
            "effective-original",
            args,
            original,
          );
          rows.set("effective-original", {
            ...row("effective-original", original, args, invocation.bytes, originalStarted),
            ...originalResult,
          });
          save();
          assertEffectiveOriginal(result, originalResult);
          continue;
        }
        reports[mode] = JSON.parse(result.stdout);
        judgeModeReport(version, mode, reports[mode], reports, inventory);
      }
    };
    const sliced = slices.map(async (slice, index) => {
      const invocation = modeInvocation("reference", {
        engine,
        reference,
        root: roots[index],
        output,
      });
      const started = performance.now();
      const result = await run(`reference-${index}`, "reference", invocation.args, roots[index]);
      rows.set(`reference-${index}`, {
        ...row("reference", roots[index], invocation.args, invocation.bytes, started),
        slice,
        ...result,
      });
      save();
      assertModeRun(result, invocation.configPath, invocation.bytes);
      return JSON.parse(result.stdout) as HostReport;
    });
    const settled = await Promise.allSettled([sequence(), ...sliced]);
    const failures = settled.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    if (failures.length)
      throw new AggregateError(failures, `${version}: host replay failed; all evidence retained`);
    const sliceReports = settled
      .slice(1)
      .map((outcome) => (outcome as PromiseFulfilledResult<HostReport>).value);
    reports.reference = mergeSliceReports(files, slices, sliceReports);
    statuses.reference = Math.max(
      ...slices.map((_, index) => rows.get(`reference-${index}`)!.status as number),
    );
    judgeModeReport(version, "reference", reports.reference, reports, inventory);
    const summary = judgeHostReports({
      version,
      inventory,
      reports,
      statuses,
      capture: capture(),
      output,
    });
    for (const [index, { start, end }] of [{ start: 0, end: files.length }, ...slices].entries())
      for (const { file, sha256: expected } of inventory.files.slice(start, end))
        assert.equal(
          sha256(fs.readFileSync(path.join(index === 0 ? original : roots[index - 1], file))),
          expected,
        );
    assert.deepEqual(verify(), inventory);
    joinHostLedgers(custody.calls, ledgerKeys(count), ledgers, path.join(output, "ledgers"));
    writeHostSummary(output, summary);
    return {
      ...summary,
      original,
      referenceSlices: slices.map((slice, index) => ({ ...slice, root: roots[index] })),
    };
  } finally {
    save();
    for (const root of [original, ...roots]) fs.rmSync(root, { recursive: true, force: true });
  }
}

// One host ledger, as the serial run appends it: every per-process ledger in
// the serial phase order. The index keeps each part's length and digest, and
// the part files are removed only after the joined bytes are verified.
export function joinHostLedgers(
  destination: string,
  keys: readonly string[],
  ledgers: ReadonlyMap<string, string>,
  directory: string,
) {
  assert.deepEqual([...ledgers.keys()].sort(), [...keys].sort(), "every ledger part is owned");
  const parts = keys.map((key) => {
    const file = ledgers.get(key)!;
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    assert.ok(bytes.length === 0 || bytes.at(-1) === 10, `${key}: complete ledger records`);
    return { key, bytes };
  });
  const joined = Buffer.concat(parts.map(({ bytes }) => bytes));
  fs.writeFileSync(destination, joined, { flag: "wx" });
  assert.ok(fs.readFileSync(destination).equals(joined));
  fs.writeFileSync(
    path.join(directory, "ledgers.json"),
    JSON.stringify(
      {
        joined: { path: destination, bytes: joined.length, sha256: sha256(joined) },
        parts: parts.map(({ key, bytes }) => ({ key, bytes: bytes.length, sha256: sha256(bytes) })),
      },
      null,
      2,
    ) + "\n",
  );
  for (const key of keys) fs.rmSync(ledgers.get(key)!, { force: true });
}
