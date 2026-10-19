import { runTypecheckCommand } from "./typecheck-command-runner.ts";

export interface VueTscBaselineRun {
  readonly durationMs: number;
  readonly exitCode: number;
  readonly output: string;
  readonly stderr: string;
  readonly stdout: string;
}

export async function runVueTscBaseline({
  vueTsc,
  args,
  cwd,
  timeoutMs,
  label,
}: {
  readonly vueTsc: { readonly path: string };
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly label: string;
}): Promise<VueTscBaselineRun> {
  const startedAt = Date.now();
  const result = await runTypecheckCommand(vueTsc.path, args, {
    cwd,
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
    maxBuffer: 1024 * 1024 * 1024,
    timeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  if (result.error != null) {
    throw new Error(`${label} failed to run: ${errorMessage(result.error)}`);
  }
  const status = result.status;
  if (status !== 0 && status !== 1 && status !== 2) {
    throw new Error(`${label} exited with unsupported status ${String(status)}`);
  }
  const stdout = result.stdout;
  const stderr = result.stderr;
  return {
    durationMs,
    exitCode: status,
    output: `${stdout}\n${stderr}`,
    stderr,
    stdout,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
