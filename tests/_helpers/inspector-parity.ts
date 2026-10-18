import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VIZE_BIN, requireVizeBin, type AppConfig } from "./apps.ts";
import {
  assertInspectorFileCoverage,
  inspectorOriginalInputs,
  type InspectorSourceAuthority,
} from "./inspector-original-inputs.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface InspectorDiffBudget {
  additions: number;
  changedFiles: number;
  officialErrors: number;
  removals: number;
  target: "dom" | "ssr";
  vizeErrors: number;
}

interface InspectorCompareReport {
  schema: string;
  target: "dom" | "ssr";
  summary: {
    additions: number;
    changedFiles: number;
    fileCount: number;
    officialErrors: number;
    removals: number;
    vizeErrors: number;
  };
  files: Array<{
    changed: boolean;
    path: string;
    stats: {
      additions: number;
      removals: number;
      unchanged: number;
    };
  }>;
}

export function assertInspectorCompareBudgets(
  app: AppConfig,
  budgets: InspectorDiffBudget[],
  sourceAuthority?: InspectorSourceAuthority,
): void {
  requireVizeBin();

  const collectAll = process.env.VIZE_INSPECTOR_COLLECT_ALL_TARGETS;
  assert.ok(collectAll === undefined || collectAll === "1", "invalid Inspector collection mode");
  assert.ok(
    !collectAll || process.env.VIZE_APP_CHECK_CAPTURE_DIR,
    "Inspector collection requires capture",
  );
  const failures: unknown[] = [];
  for (const budget of budgets) {
    try {
      const { report, invocation } = runInspectorCompare(
        app,
        budget.target,
        sourceAuthority !== undefined,
      );
      assert.equal(report.schema, "vize.inspector.compare");
      assert.equal(report.target, budget.target);
      assert.ok(report.summary.fileCount > 0, `${app.name}:${budget.target} should inspect files`);
      writeInspectorReport(app.name, budget.target, report);
      if (sourceAuthority) {
        assert.ok(app.check, "original Inspector source patterns are required");
        assert.ok(invocation, "original-source qualification requires same-child custody");
        const expected = inspectorOriginalInputs(REPO_ROOT, app.check, sourceAuthority, invocation);
        const input = JSON.parse(
          fs.readFileSync(path.join(invocation, "official/input.json"), "utf8"),
        );
        assertInspectorFileCoverage(report, expected, input);
      }
      assertBudget(report, budget, app.name);
    } catch (error) {
      if (!collectAll) throw error;
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `${app.name} Inspector comparisons failed`);
}

function runInspectorCompare(
  app: AppConfig,
  target: "dom" | "ssr",
  forceCapture = false,
): { report: InspectorCompareReport; invocation?: string } {
  const check = app.check;
  assert.ok(check, `${app.name} should define check fixtures`);
  const capture =
    inspectorCaptureDirectory(app.name) ??
    (forceCapture ? inspectorReportDirectory(app.name) : undefined);
  if (capture) fs.mkdirSync(capture, { recursive: true });
  const invocation = capture ? fs.mkdtempSync(path.join(capture, `${target}-`)) : undefined;
  const args = [
    "inspector",
    ...check.patterns,
    "--format",
    "compare",
    "--target",
    target,
    "--template-syntax",
    "quirks",
  ];
  const beforeImage = invocation ? inspectorImage() : undefined;
  const startedAt = performance.now();
  const raw = spawnSync(VIZE_BIN, args, {
    cwd: check.cwd,
    encoding: invocation ? null : "utf8",
    env: {
      ...process.env,
      LANG: "C",
      LC_ALL: "C",
      ...(invocation ? { VIZE_INSPECTOR_CAPTURE_DIR: path.join(invocation, "official") } : {}),
    },
    maxBuffer: 512 * 1024 * 1024,
    timeout: 300_000,
  });
  const durationMs = performance.now() - startedAt;
  const result = {
    ...raw,
    stdout: Buffer.isBuffer(raw.stdout) ? raw.stdout.toString("utf8") : raw.stdout,
    stderr: Buffer.isBuffer(raw.stderr) ? raw.stderr.toString("utf8") : raw.stderr,
  };
  if (invocation) {
    fs.writeFileSync(path.join(invocation, "stdout.txt"), raw.stdout ?? "");
    fs.writeFileSync(path.join(invocation, "stderr.txt"), raw.stderr ?? "");
    fs.writeFileSync(
      path.join(invocation, "process.json"),
      JSON.stringify(
        {
          command: VIZE_BIN,
          args,
          cwd: check.cwd,
          status: result.status,
          signal: result.signal,
          error: result.error?.message ?? null,
          durationMs,
          timeoutMs: 300_000,
          beforeImage,
          afterImage: inspectorImage(),
          officialNodeOverride: process.env.VIZE_INSPECTOR_NODE ?? null,
          parentNodeEnv: process.env.NODE_ENV ?? null,
        },
        null,
        2,
      ) + "\n",
    );
  }

  if (result.error != null) {
    throw result.error;
  }
  assert.equal(
    result.status,
    0,
    `${app.name}:${target} inspector compare failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  return { report: JSON.parse(result.stdout) as InspectorCompareReport, invocation };
}

function assertBudget(
  report: InspectorCompareReport,
  budget: InspectorDiffBudget,
  appName: string,
): void {
  const label = `${appName}:${budget.target}`;
  assert.equal(report.summary.officialErrors, budget.officialErrors, `${label} official errors`);
  assert.equal(report.summary.vizeErrors, budget.vizeErrors, `${label} vize errors`);
  assert.ok(
    report.summary.changedFiles <= budget.changedFiles,
    `${label} changed file budget: ${report.summary.changedFiles} > ${budget.changedFiles}`,
  );
  assert.ok(
    report.summary.additions <= budget.additions,
    `${label} addition budget: ${report.summary.additions} > ${budget.additions}`,
  );
  assert.ok(
    report.summary.removals <= budget.removals,
    `${label} removal budget: ${report.summary.removals} > ${budget.removals}`,
  );
}

function writeInspectorReport(
  appName: string,
  target: "dom" | "ssr",
  report: InspectorCompareReport,
): void {
  const outputRoot = inspectorReportDirectory(
    appName,
    process.env.VIZE_INSPECT_OUTPUT_DIR ?? inspectorCaptureDirectory(appName),
  );
  fs.mkdirSync(outputRoot, { recursive: true });

  fs.writeFileSync(path.join(outputRoot, `${target}.json`), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(
    path.join(outputRoot, `${target}-summary.json`),
    JSON.stringify(
      {
        summary: report.summary,
        largestDiffs: report.files
          .filter((file) => file.changed)
          .map((file) => ({
            path: file.path,
            additions: file.stats.additions,
            removals: file.stats.removals,
          }))
          .sort((a, b) => b.additions + b.removals - (a.additions + a.removals))
          .slice(0, 50),
      },
      null,
      2,
    ) + "\n",
  );
}

/**
 * Resolve the directory used for one application's inspector reports.
 *
 * @param outputDirectory - Explicit directory supplied by the test environment.
 * @default `<repository>/.vize/artifacts/inspect/<application>`
 */
export function inspectorReportDirectory(appName: string, outputDirectory?: string): string {
  return (
    outputDirectory ?? path.join(REPO_ROOT, ".vize", "artifacts", "inspect", sanitizeName(appName))
  );
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
}

function inspectorCaptureDirectory(appName: string): string | undefined {
  const root = process.env.VIZE_APP_CHECK_CAPTURE_DIR;
  if (!root) return undefined;
  const name = sanitizeName(appName);
  assert.ok(name && name !== "." && name !== "..", "invalid inspector capture application");
  return path.join(root, "inspector", name);
}

function inspectorImage() {
  try {
    return {
      file: VIZE_BIN,
      physical: fs.realpathSync(VIZE_BIN),
      sha256: createHash("sha256").update(fs.readFileSync(VIZE_BIN)).digest("hex"),
    };
  } catch (error) {
    return { file: VIZE_BIN, error: String(error) };
  }
}
