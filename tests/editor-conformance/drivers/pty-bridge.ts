// Run a terminal editor in a pseudo-terminal for the TS-45 Helix driver.
//
// Keystrokes arrive on this process's stdin (a pipe from the Node driver) and
// are written to the terminal; everything the editor draws is appended to the
// --screen file so a failing CI run can show what the editor displayed. The
// editor's startup terminal queries get the answers a plain VT220-class
// terminal gives (a DA1 reply and nothing else), so it never waits on them.
//
// usage: pty-bridge.ts --cols N --rows N --screen FILE -- COMMAND [ARG ...]
import { closeSync, openSync } from "node:fs";
import {
  exitCodeOf,
  hangUpOnTermination,
  startPtySession,
  writeAll,
} from "../../tooling/support/pty-session.ts";

// Primary device attributes: "VT220 with ANSI color". Editors send DA1 after
// their feature probes and treat the reply as "no more answers are coming".
const DA1_QUERY = Buffer.from("\x1b[c");
const DA1_REPLY = Buffer.from("\x1b[?62;22c");
const usage = "usage: pty-bridge.ts --cols N --rows N --screen FILE -- COMMAND [ARG ...]";

interface Options {
  readonly cols: number;
  readonly rows: number;
  readonly screen: string;
  readonly command: readonly string[];
}

function fail(message: string): never {
  writeAll(2, Buffer.from(`${usage}\npty-bridge.ts: error: ${message}\n`));
  process.exit(2);
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let command: readonly string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    const option = /^--(cols|rows|screen)(?:=(.*))?$/su.exec(argument);
    if (option === null) {
      if (argument.startsWith("-") && argument !== "--")
        fail(`unrecognized arguments: ${argument}`);
      command = argv.slice(argument === "--" ? index + 1 : index);
      break;
    }
    const [, name = "", inline] = option;
    const value = inline ?? argv[(index += 1)];
    if (value === undefined) fail(`argument --${name}: expected one argument`);
    values.set(name, value);
  }
  const missing = ["cols", "rows", "screen"].filter((name) => !values.has(name));
  if (missing.length > 0)
    fail(`the following arguments are required: ${missing.map((name) => `--${name}`).join(", ")}`);
  const size = (name: string): number => {
    const value = values.get(name) ?? "";
    if (!/^\s*[+-]?\d+\s*$/u.test(value)) fail(`argument --${name}: invalid int value: '${value}'`);
    return Number(value);
  };
  if (command.length === 0) fail("missing COMMAND");
  return { cols: size("cols"), rows: size("rows"), screen: values.get("screen") ?? "", command };
}

function count(window: Buffer, pattern: Buffer): number {
  let found = 0;
  for (let at = window.indexOf(pattern); at >= 0; at = window.indexOf(pattern, at + pattern.length))
    found += 1;
  return found;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  // A shell is the session leader, as in a real terminal: when the editor
  // itself led the session, its exit hung up the terminal and SIGHUP killed
  // the language server it had just asked to `exit` before the server could.
  // The shell outlives the editor by a grace period, the way a terminal stays
  // open after the editor quits. It sizes the terminal before the editor runs.
  const session = startPtySession([
    "/bin/sh",
    "-c",
    'stty rows "$1" cols "$2"; shift 2; "$@"; status=$?; sleep 5; exit "$status"',
    "sh",
    String(options.rows),
    String(options.cols),
    ...options.command,
  ]);
  const { script } = session;
  hangUpOnTermination(script);
  const screen = openSync(options.screen, "a");
  let tail = Buffer.alloc(0);
  script.stdout.on("data", (chunk: Buffer) => {
    writeAll(screen, chunk);
    const window = Buffer.concat([tail, chunk]);
    for (let reply = count(window, DA1_QUERY); reply > 0; reply -= 1) session.write(DA1_REPLY);
    tail = window.subarray(Math.max(0, window.length - (DA1_QUERY.length - 1)));
  });
  process.stdin.on("data", (keys: Buffer) => session.write(keys));
  script.on("error", (error) => {
    writeAll(2, Buffer.from(`pty-bridge.ts: ${error.message}\n`));
    process.exit(1);
  });
  script.on("close", (code, signal) => {
    closeSync(screen);
    process.exit(exitCodeOf(code, signal));
  });
}

main();
