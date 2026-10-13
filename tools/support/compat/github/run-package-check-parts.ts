import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PartResult = {
  part: string;
  status: number | null;
  signal: string | null;
  output: Buffer;
};
type Run = (part: string, directory: string) => Promise<PartResult>;

// A package script written as `pnpm a && pnpm b && ...` whose parts are
// independent checks. The parts are read from package.json on every run, so
// CI always runs exactly the script's current checks.
export function scriptParts(directory: string, script: string): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  const body = manifest.scripts?.[script];
  assert.equal(typeof body, "string", `${directory} has no ${script} script`);
  const parts = body.split(" && ");
  for (const part of parts)
    assert.match(part, /^pnpm [a-z][a-z0-9:-]*$/u, `${script}: not a package script call: ${part}`);
  assert.equal(new Set(parts).size, parts.length, `${script}: repeated part`);
  return parts.map((part: string) => part.slice("pnpm ".length));
}

// The exact command the script runs for one part, in the package directory.
const runPart: Run = (part, directory) =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn("pnpm", [part], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", (error) => {
      chunks.push(Buffer.from(`${String(error)}\n`));
      resolve({ part, status: null, signal: null, output: Buffer.concat(chunks) });
    });
    child.once("close", (status, signal) =>
      resolve({ part, status, signal, output: Buffer.concat(chunks) }),
    );
  });

// Run every part concurrently and wait for all of them, unlike `&&`, which
// stops at the first failure. Each part's output is printed whole, in
// script order. The result fails when any part fails.
export async function runScriptParts(
  directory: string,
  script: string,
  {
    run = runPart,
    write = (bytes) => process.stdout.write(bytes),
  }: { run?: Run; write?: (bytes: Uint8Array | string) => unknown } = {},
): Promise<number> {
  const results = await Promise.all(
    scriptParts(directory, script).map((part) => run(part, directory)),
  );
  for (const { part, status, signal, output } of results) {
    write(`::group::pnpm ${part} (${signal ?? `exit ${status}`})\n`);
    write(output);
    write("::endgroup::\n");
  }
  const failed = results.filter(({ status, signal }) => status !== 0 || signal !== null);
  for (const { part } of failed) write(`pnpm ${part} failed in ${script}\n`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, script, ...rest] = process.argv.slice(2);
  assert.ok(
    directory && script && rest.length === 0,
    "usage: run-package-check-parts.ts DIR SCRIPT",
  );
  process.exitCode = await runScriptParts(path.resolve(directory), script);
}
