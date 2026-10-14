// A pseudo-terminal session for tooling helpers without a native dependency.
// The system `script(1)` owns the terminal: it opens the pty, makes the
// command a session leader on its slave and relays bytes between its own
// stdio and the master. Its stdin stays open for the whole session, so it
// never forwards an end-of-file character the command did not receive.
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { closeSync, openSync, opendirSync, readSync, writeSync } from "node:fs";
import { constants } from "node:os";
import type { Readable, Writable } from "node:stream";

export type ScriptProcess = ChildProcessByStdio<Writable, Readable, null>;

export interface PtySession {
  readonly script: ScriptProcess;
  /** The session leader `script(1)` started on the terminal, once it exists. */
  readonly leader: () => number | null;
  /** Write bytes to the terminal, as typed input. */
  readonly write: (data: Uint8Array) => void;
}

interface Invocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * util-linux `script` runs one `$SHELL -c` string: it runs under `/bin/sh`,
 * restores the caller's `SHELL` and execs the exact argv, so the command
 * itself leads the session. BSD and macOS `script` take argv but refuse a
 * socket stdin (Node's stdio pipes and macOS FIFOs are sockets), so bash
 * replaces itself with `script` reading a real pipe that `cat` fills.
 */
export function scriptInvocation(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Invocation {
  if (platform !== "linux") {
    return {
      file: "/bin/bash",
      args: ["-c", 'exec script -q /dev/null "$@" < <(exec cat)', "bash", ...command],
      env,
    };
  }
  const shell = env.SHELL;
  const restore =
    shell === undefined ? "unset SHELL; " : `SHELL=${shellQuote(shell)}; export SHELL; `;
  return {
    file: "script",
    args: ["-q", "-e", "-c", `${restore}exec ${command.map(shellQuote).join(" ")}`, "/dev/null"],
    env: { ...env, SHELL: "/bin/sh" },
  };
}

function readText(file: string, limit = 65536): string {
  const descriptor = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    let length = 0;
    while (length < limit) {
      const read = readSync(descriptor, buffer, length, limit - length, null);
      if (read === 0) break;
      length += read;
    }
    return buffer.subarray(0, length).toString("latin1");
  } finally {
    closeSync(descriptor);
  }
}

/** Fields after the parenthesized command name of `/proc/PID/stat`. */
export function statFields(text: string): readonly string[] | null {
  const end = text.lastIndexOf(")");
  if (end < 0) return null;
  return text
    .slice(end + 1)
    .split(/\s+/u)
    .filter((field) => field.length > 0);
}

/** The child of `script(1)` that leads its own process group. */
function sessionLeader(script: number): number | null {
  if (process.platform === "linux") {
    const entries = opendirSync("/proc");
    try {
      for (let entry = entries.readSync(); entry !== null; entry = entries.readSync()) {
        if (!/^\d+$/u.test(entry.name)) continue;
        try {
          const fields = statFields(readText(`/proc/${entry.name}/stat`));
          if (fields !== null && Number(fields[1]) === script && fields[2] === entry.name)
            return Number(entry.name);
        } catch {
          continue;
        }
      }
    } finally {
      entries.closeSync();
    }
    return null;
  }
  const listed = spawnSync("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid="], {
    encoding: "utf8",
  });
  for (const line of (listed.stdout ?? "").split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/u);
    if (pid !== undefined && Number(ppid) === script && pgid === pid) return Number(pid);
  }
  return null;
}

/** The terminal's foreground process group, read through its session leader. */
export function foregroundGroup(leader: number | null): number | null {
  if (leader === null) return null;
  try {
    if (process.platform === "linux") {
      const tpgid = statFields(readText(`/proc/${leader}/stat`))?.[5];
      return tpgid === undefined ? null : Number(tpgid);
    }
    const listed = spawnSync("ps", ["-o", "tpgid=", "-p", String(leader)], { encoding: "utf8" });
    const value = (listed.stdout ?? "").trim();
    return listed.status === 0 && /^-?\d+$/u.test(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

/** Start COMMAND as the session leader of a new pseudo-terminal. */
export function startPtySession(command: readonly string[]): PtySession {
  const invocation = scriptInvocation(command, process.env);
  const script = spawn(invocation.file, [...invocation.args], {
    env: invocation.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  // A broken relay surfaces as the session's exit status, never as an
  // unhandled stream error.
  script.stdin.on("error", () => {});
  let leader: number | null = null;
  return {
    script,
    leader: () => {
      if (leader === null && script.pid !== undefined) leader = sessionLeader(script.pid);
      return leader;
    },
    write: (data) => {
      script.stdin.write(data);
    },
  };
}

/**
 * When this helper dies the terminal must hang up, as it does when the
 * process holding the master exits: `script(1)` is killed, the master closes
 * and the session receives SIGHUP. The signal is then delivered again.
 */
export function hangUpOnTermination(script: ScriptProcess): void {
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      script.kill("SIGKILL");
      process.kill(process.pid, signal);
    });
  }
}

export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  return 128 + (signal === null ? 0 : constants.signals[signal]);
}

export function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Write every byte to a descriptor that may be non-blocking. */
export function writeAll(descriptor: number, data: Uint8Array): void {
  let offset = 0;
  while (offset < data.length) {
    try {
      offset += writeSync(descriptor, data, offset, data.length - offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      sleepSync(1);
    }
  }
}
