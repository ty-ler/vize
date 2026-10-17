/** The same strict H consumer for the proposed host-only repair, without operator authority. */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureIo } from "./io.ts";
import { repair457, sha256 } from "./contract.ts";

export async function executeImmutableFixture(io: ReturnType<typeof captureIo>, consumer: Buffer) {
  assert.equal(sha256(consumer), repair457.consumerSha256);
  const consumerRoot = mkdtempSync(resolve(process.env.RUNNER_TEMP!, "release-457-consumer-"));
  const cache = mkdtempSync(resolve(process.env.RUNNER_TEMP!, "release-457-deno-cache-"));
  writeFileSync(resolve(consumerRoot, "consumer.ts"), consumer, { flag: "wx" });
  const packageJson = '{ "name": "vize-jsr-consumer", "private": true, "type": "module" }\n';
  writeFileSync(resolve(consumerRoot, "package.json"), packageJson, { flag: "wx" });
  writeFileSync(resolve(consumerRoot, "deno.json"), repair457.config, { flag: "wx" });
  assert.deepEqual(readdirSync(cache), []);
  assert.deepEqual(
    readdirSync(consumerRoot).sort((a, b) => a.localeCompare(b)),
    ["consumer.ts", "deno.json", "package.json"],
  );
  const runtime = (await io.command("deno-version", "deno", ["--version"])).toString();
  assert.match(runtime, /^deno 2\.9\.7 \(stable,/);
  const result = await io.command(
    "published-consumer",
    "deno",
    ["run", "--config", "deno.json", "--allow-all", "consumer.ts", "jsr:@vizejs/vize@0.457.0"],
    consumerRoot,
    { ...process.env, DENO_DIR: cache },
  );
  assert.equal(result.toString(), "Verified jsr:@vizejs/vize@0.457.0 (no flags)\n");
  const lock = resolve(consumerRoot, "deno.lock");
  const fixture = {
    schema: "vize-457-host-only-consumer-v1",
    consumerSha256: sha256(consumer),
    config: repair457.config,
    runtime,
    cacheWasEmpty: true,
    packageJson,
    stdout: result.toString(),
    denoLock: existsSync(lock) ? readFileSync(lock, "utf8") : null,
    scope:
      "Consumer execution only. No original Release status, source closure or publication authority.",
  };
  io.json("fixture", fixture);
  return fixture;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  assert.ok(output && process.env.RUNNER_TEMP);
  mkdirSync(output, { recursive: false });
  const io = captureIo(output);
  await io.command("fetch-immutable-source", "git", [
    "fetch",
    "--no-tags",
    "origin",
    repair457.head,
  ]);
  const consumer = await io.command("immutable-consumer", "git", [
    "show",
    `${repair457.head}:tools/support/release/jsr/consumer.ts`,
  ]);
  await executeImmutableFixture(io, consumer);
  console.log(
    "Exact immutable H consumer passed with only nodeModulesDir:none; original Release remains failed.",
  );
}
