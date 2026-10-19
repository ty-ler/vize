import { spawn } from "node:child_process";

const defaultForceKillDelayMs = 5_000;
const defaultForceSettleDelayMs = 10_000;
const defaultMaxBuffer = 1024 * 1024 * 1024;

export type CodedError = Error & { code?: string };

export interface TypecheckCommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly maxBuffer?: number;
  readonly forceKillDelayMs?: number;
  readonly forceSettleDelayMs?: number;
}

export interface TypecheckCommandResult {
  readonly error: CodedError | null;
  readonly signal: string | null;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function codedError(message: string, code: string): CodedError {
  return Object.assign(new Error(message), { code });
}

export function runTypecheckCommand(
  command: string,
  args: readonly string[],
  options: TypecheckCommandOptions,
): Promise<TypecheckCommandResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive safe integer");
  }
  return new Promise<TypecheckCommandResult>((settle) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let spawnError: CodedError | null = null;
    let timeoutError: CodedError | null = null;
    let maxBufferError: CodedError | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let forceSettleTimer: ReturnType<typeof setTimeout> | undefined;
    let terminating = false;
    let settled = false;
    const maxBuffer = options.maxBuffer ?? defaultMaxBuffer;
    const forceKillDelayMs =
      options.forceKillDelayMs ?? Math.min(defaultForceKillDelayMs, options.timeoutMs);
    const forceSettleDelayMs =
      options.forceSettleDelayMs ??
      forceKillDelayMs + Math.min(defaultForceSettleDelayMs, options.timeoutMs);

    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    function stopTimers(): void {
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      clearTimeout(forceSettleTimer);
    }

    function settleResult(status: number | null, signal: string | null): void {
      if (settled) return;
      settled = true;
      stopTimers();
      settle({
        error: spawnError ?? timeoutError ?? maxBufferError,
        signal,
        status: spawnError == null ? status : null,
        stderr,
        stdout,
      });
    }

    function signalChildTree(signal: "SIGTERM" | "SIGKILL"): void {
      if (child.pid == null) {
        child.kill(signal);
        return;
      }
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch (error) {
          if ((error as CodedError | null)?.code === "ESRCH") return;
        }
      }
      child.kill(signal);
    }

    function beginTermination(): void {
      if (terminating) return;
      terminating = true;
      signalChildTree("SIGTERM");
      forceKillTimer = setTimeout(() => signalChildTree("SIGKILL"), forceKillDelayMs);
      forceKillTimer.unref();
      forceSettleTimer = setTimeout(() => settleResult(null, "SIGKILL"), forceSettleDelayMs);
      forceSettleTimer.unref();
    }

    function killForMaxBuffer(streamName: string): void {
      if (maxBufferError != null) return;
      maxBufferError = codedError(`${streamName} maxBuffer exceeded`, "ENOBUFS");
      beginTermination();
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > maxBuffer) killForMaxBuffer("stdout");
      else stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > maxBuffer) killForMaxBuffer("stderr");
      else stderr += chunk;
    });
    child.once("error", (error) => {
      spawnError = error;
      settleResult(null, null);
    });
    child.once("close", (status, signal) => {
      settleResult(status, signal);
    });

    timeoutTimer = setTimeout(() => {
      timeoutError = codedError(`spawn timed out after ${options.timeoutMs}ms`, "ETIMEDOUT");
      beginTermination();
    }, options.timeoutMs);
    timeoutTimer.unref();
  });
}
