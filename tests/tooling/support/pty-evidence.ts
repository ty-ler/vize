// Bounded Linux lifecycle evidence for pty-command.ts. It never records argv
// values, input or environment: commands reduce to fixed phase labels and file
// descriptors to anonymous pipe and socket identities. Records keep the
// established JSON Lines shape, spacing included.
import { closeSync, openSync, opendirSync, readSync, readlinkSync, type Dir } from "node:fs";
import { performance } from "node:perf_hooks";
import { sleepSync, statFields, writeAll } from "./pty-session.ts";

const gitFlags = new Set([
  "--no-pager",
  "--paginate",
  "-p",
  "-P",
  "--bare",
  "--no-replace-objects",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--no-optional-locks",
  "--no-lazy-fetch",
  "--no-advice",
]);
const gitValues = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const gitAssignments = ["--git-dir=", "--work-tree=", "--namespace=", "--config-env="];
const knownBinaries = new Set([
  "vp",
  "node",
  "sh",
  "bash",
  "moon",
  "moonc",
  "moondoc",
  "gcc",
  "cc",
  "clang",
  "git",
  "git-remote-http",
  "git-remote-https",
  "ssh",
  "release.exe",
  "release",
]);
const knownOperations: Readonly<Record<string, readonly string[]>> = {
  moon: ["update", "run", "build"],
  git: [
    "pull",
    "fetch",
    "remote-http",
    "remote-https",
    "index-pack",
    "credential",
    "credential-cache",
    "maintenance",
    "config",
    "rev-parse",
  ],
};

/**
 * Skip known Git global options; refuse ambiguous option shapes. Arguments
 * are byte strings (one latin1 character per byte), as `/proc` stores them.
 */
export function gitOperation(argumentsList: readonly string[]): string | null {
  let index = 1;
  while (index < argumentsList.length) {
    const argument = argumentsList[index] ?? "";
    if (gitFlags.has(argument)) {
      index += 1;
    } else if (gitValues.has(argument)) {
      if (index + 1 >= argumentsList.length) return null;
      if (!argumentsList[index + 1] && argument !== "-C") return null;
      index += 2;
    } else if (gitAssignments.some((prefix) => argument.startsWith(prefix))) {
      if (!argument.slice(argument.indexOf("=") + 1)) return null;
      if (argument.startsWith("--config-env=")) {
        const fields = argument.split("=");
        if (fields.length !== 3 || !fields[1] || !fields[2]) return null;
      }
      index += 1;
    } else if ((argument.startsWith("-C") || argument.startsWith("-c")) && argument.length > 2) {
      index += 1;
    } else if (!argument || argument.startsWith("-")) {
      return null;
    } else {
      return argument;
    }
  }
  return null;
}

/** Return only fixed labels, including Git's dispatched transport stages. */
export function commandPhase(argumentsList: readonly string[]): string {
  const first = argumentsList[0] ?? "";
  const binary = first.slice(first.lastIndexOf("/") + 1);
  const phase = knownBinaries.has(binary) ? binary : "other";
  let operation: string | null | undefined = null;
  if (binary === "git") operation = gitOperation(argumentsList);
  else if (argumentsList.length > 1) operation = argumentsList[1];
  if (operation != null && (knownOperations[binary] ?? []).includes(operation))
    return `${phase}:${operation}`;
  return phase;
}

/** Retain only anonymous channel identities, never paths or socket peers. */
export function processChannels(
  processPath: string,
  openDirectory: (path: string) => Pick<Dir, "readSync" | "closeSync"> = opendirSync,
): ReadonlyMap<string, string> {
  const channels = new Map<string, string>();
  let entries: Pick<Dir, "readSync" | "closeSync">;
  try {
    entries = openDirectory(`${processPath}/fd`);
  } catch {
    return channels;
  }
  try {
    for (let examined = 0; examined < 256; examined += 1) {
      const entry = entries.readSync();
      if (entry === null) break;
      if (!/^\d+$/u.test(entry.name)) continue;
      try {
        const target = readlinkSync(`${processPath}/fd/${entry.name}`);
        if (target.startsWith("pipe:[") || target.startsWith("socket:["))
          channels.set(entry.name, target);
      } catch {
        continue;
      }
      if (channels.size >= 64) break;
    }
  } catch {
    // A process that exits mid-scan keeps the channels read so far.
  } finally {
    entries.closeSync();
  }
  return channels;
}

/** JSON as Python's `json.dumps` writes it: `", "`/`": "` and ASCII only. */
function text(value: string): string {
  // Per UTF-16 unit, so astral characters become surrogate-pair escapes.
  let ascii = "";
  for (const unit of JSON.stringify(value).split("")) {
    const code = unit.charCodeAt(0);
    ascii += code > 0x7e ? `\\u${code.toString(16).padStart(4, "0")}` : unit;
  }
  return ascii;
}

function float(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function object(fields: readonly (readonly [string, string])[]): string {
  return `{${fields.map(([key, value]) => `${text(key)}: ${value}`).join(", ")}}`;
}

interface ProcessRecord {
  readonly pid: number;
  readonly ppid: number;
  readonly pgrp: number;
  readonly session: number;
  readonly foreground: number;
  readonly state: string;
  readonly phase: string;
  readonly wait: string;
  readonly channels: ReadonlyMap<string, string>;
}

function processJson(record: ProcessRecord): string {
  return object([
    ["pid", String(record.pid)],
    ["ppid", String(record.ppid)],
    ["pgrp", String(record.pgrp)],
    ["session", String(record.session)],
    ["foreground", String(record.foreground)],
    ["state", text(record.state)],
    ["phase", text(record.phase)],
    ["wait", text(record.wait)],
    ["channels", object([...record.channels].map(([fd, target]) => [fd, text(target)] as const))],
  ]);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function readBytes(file: string, limit: number): Buffer {
  const descriptor = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    let length = 0;
    while (length < limit) {
      const read = readSync(descriptor, buffer, length, limit - length, null);
      if (read === 0) break;
      length += read;
    }
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

function integer(value: string | undefined): number {
  if (value === undefined || !/^\s*[+-]?\d+\s*$/u.test(value)) throw new RangeError("not an int");
  return Number(value);
}

function sessionProcesses(child: number): ProcessRecord[] {
  const processes: ProcessRecord[] = [];
  const entries = opendirSync("/proc");
  try {
    for (let entry = entries.readSync(); entry !== null; entry = entries.readSync()) {
      if (!/^\d+$/u.test(entry.name)) continue;
      const path = `/proc/${entry.name}`;
      try {
        const stat = statFields(utf8.decode(readBytes(`${path}/stat`, 1 << 16)));
        if (stat === null) continue;
        if (integer(stat[3]) !== child) continue;
        const argumentsList = readBytes(`${path}/cmdline`, 4096).toString("latin1").split("\0");
        const waiting = utf8.decode(readBytes(`${path}/wchan`, 1 << 16)).trim();
        processes.push({
          pid: integer(entry.name),
          ppid: integer(stat[1]),
          pgrp: integer(stat[2]),
          session: integer(stat[3]),
          foreground: integer(stat[5]),
          state: stat[0] ?? "",
          phase: commandPhase(argumentsList),
          wait: waiting,
          channels: processChannels(path),
        });
      } catch {
        continue;
      }
      if (processes.length >= 256) break;
    }
  } finally {
    entries.closeSync();
  }
  return processes;
}

export class LifecycleEvidence {
  readonly #leader: () => number | null;
  readonly #foreground: (leader: number | null) => number | null;
  readonly #started = performance.now() / 1000;
  readonly #destination: number | null = null;
  #nextSnapshot = 0;
  #records = 0;

  constructor(
    leader: () => number | null,
    foreground: (leader: number | null) => number | null,
    evidencePath: string | undefined = process.env.VIZE_PTY_EVIDENCE,
  ) {
    this.#leader = leader;
    this.#foreground = foreground;
    if (evidencePath) this.#destination = openSync(`${evidencePath}.${process.pid}.jsonl`, "wx");
  }

  record(event: string, force = false, failure = false): void {
    const now = performance.now() / 1000;
    if ((this.#destination === null && !failure) || this.#records >= 128) return;
    if (!force && now < this.#nextSnapshot) return;
    this.#nextSnapshot = now + 0.5;
    // `script(1)` forks the session leader just after it starts.
    let child = this.#leader();
    for (let attempt = 0; child === null && attempt < 20; attempt += 1) {
      sleepSync(50);
      child = this.#leader();
    }
    const processes = process.platform === "linux" && child !== null ? sessionProcesses(child) : [];
    processes.sort((left, right) => left.pid - right.pid);
    const record = object([
      ["event", text(event)],
      ["elapsed", float(Math.round((now - this.#started) * 1000) / 1000)],
      ["child", child === null ? "null" : String(child)],
      ["foreground", String(this.#foreground(child) ?? "null")],
      ["processes", `[${processes.map(processJson).join(", ")}]`],
    ]);
    if (this.#destination !== null) writeAll(this.#destination, Buffer.from(`${record}\n`));
    if (failure) writeAll(2, Buffer.from(`PTY lifecycle: ${record}\n`));
    this.#records += 1;
  }

  close(): void {
    if (this.#destination !== null) closeSync(this.#destination);
  }
}
