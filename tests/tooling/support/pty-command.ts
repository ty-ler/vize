// Run a command in a pseudo-terminal and answer after a prompt appears.
//
// usage: pty-command.ts PROMPT RESPONSE COMMAND [ARG ...]
//
// Terminal output is copied to stdout. Exits 124 when the 25 second deadline
// terminates the session, 125 when the prompt never appeared, and otherwise
// with the command's own status.
import { LifecycleEvidence } from "./pty-evidence.ts";
import {
  exitCodeOf,
  foregroundGroup,
  hangUpOnTermination,
  sleepSync,
  startPtySession,
  writeAll,
} from "./pty-session.ts";

function exists(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function signalGroup(leader: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-leader, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function waitForExit(leader: number, timeoutSeconds: number): void {
  const deadline = performance.now() + timeoutSeconds * 1000;
  while (performance.now() < deadline && exists(leader)) sleepSync(50);
}

function terminateProcessGroup(leader: number | null): void {
  if (leader === null) return;
  signalGroup(leader, "SIGTERM");
  waitForExit(leader, 1);
  if (!exists(-leader)) return;
  signalGroup(leader, "SIGKILL");
  waitForExit(leader, 1);
}

function main(): void {
  const [prompt, response, ...command] = process.argv.slice(2);
  if (prompt === undefined || response === undefined || command.length === 0) {
    writeAll(2, Buffer.from("usage: pty-command.ts PROMPT RESPONSE COMMAND [ARG ...]\n"));
    process.exit(1);
  }
  const promptBytes = Buffer.from(prompt);
  const responseBytes = Buffer.from(response);
  const session = startPtySession(command);
  const { script } = session;
  hangUpOnTermination(script);
  const evidence = new LifecycleEvidence(session.leader, foregroundGroup);
  const deadline = performance.now() + 25_000;
  let output = Buffer.alloc(0);
  let answered = false;

  const tick = (): void => {
    if (performance.now() < deadline) {
      evidence.record("waiting");
      return;
    }
    clearInterval(timer);
    evidence.record("deadline", true, true);
    terminateProcessGroup(session.leader());
    evidence.record("terminated", true);
    evidence.close();
    script.kill("SIGKILL");
    process.exit(124);
  };
  const timer = setInterval(tick, 100);
  tick();

  script.stdout.on("data", (chunk: Buffer) => {
    writeAll(1, chunk);
    const searchFrom = Math.max(0, output.length - promptBytes.length + 1);
    output = Buffer.concat([output, chunk]);
    if (!answered && output.indexOf(promptBytes, searchFrom) >= 0) {
      evidence.record("prompt", true);
      session.write(responseBytes);
      answered = true;
      evidence.record("answered", true);
    }
  });
  script.on("error", (error) => {
    writeAll(2, Buffer.from(`pty-command.ts: ${error.message}\n`));
    process.exit(1);
  });
  script.on("close", (code, signal) => {
    clearInterval(timer);
    evidence.record("child-exit", true);
    evidence.close();
    process.exit(answered ? exitCodeOf(code, signal) : 125);
  });
}

main();
