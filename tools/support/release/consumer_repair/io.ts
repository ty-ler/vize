import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256, type ObjectValue } from "./contract.ts";

/** Drain and retain both entire byte streams before applying any process gate. No retry. */
export function captureIo(output: string) {
  let sequence = 0;
  function json(name: string, value: unknown) {
    const fd = openSync(resolve(output, `${name}.json`), "wx");
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  async function command(
    label: string,
    executable: string,
    args: string[],
    cwd?: string,
    env?: NodeJS.ProcessEnv,
    input?: string,
  ) {
    const prefix = `${++sequence}-${label}`;
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    const paths = {
      stdout: resolve(output, `${prefix}.stdout`),
      stderr: resolve(output, `${prefix}.stderr`),
    };
    for (const path of Object.values(paths)) writeFileSync(path, Buffer.alloc(0), { flag: "wx" });
    const child = spawn(executable, args, {
      cwd,
      env: env ?? process.env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    child.stdout!.on("data", (bytes: Buffer) => {
      appendFileSync(paths.stdout, bytes);
      stdout.push(bytes);
    });
    child.stderr!.on("data", (bytes: Buffer) => {
      appendFileSync(paths.stderr, bytes);
      stderr.push(bytes);
    });
    const result = await new Promise<{
      code: number | null;
      signal: string | null;
      error: string | null;
    }>((done) => {
      let error: string | null = null;
      child.on("error", (caught) => {
        error = caught.message;
      });
      child.on("close", (code, signal) => done({ code, signal, error }));
      if (input !== undefined) {
        child.stdin!.on("error", (caught) => {
          error = caught.message;
        });
        child.stdin!.end(input);
      }
    });
    const out = Buffer.concat(stdout),
      err = Buffer.concat(stderr);
    json(prefix, {
      executable,
      args,
      cwd: cwd ?? process.cwd(),
      ...result,
      ...(input === undefined ? {} : { inputSha256: sha256(input) }),
      stdout: { bytes: out.length, sha256: sha256(out) },
      stderr: { bytes: err.length, sha256: sha256(err) },
    });
    assert.equal(result.error, null, `${label} failed to spawn/write`);
    assert.equal(result.signal, null, `${label} was terminated`);
    assert.equal(result.code, 0, `${label} failed; whole raw streams retained`);
    return out;
  }
  async function api(path: string) {
    return JSON.parse((await command("github", "gh", ["api", path])).toString()) as ObjectValue;
  }
  return { json, command, api };
}
