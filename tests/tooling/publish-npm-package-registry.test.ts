import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { runReleaseCommand } from "./support/release-command.ts";
import { writeFakeCommand } from "./support/fake-command.ts";
import { writeFakeNpmRegistry } from "./support/fake-npm-registry.ts";

test("parallel registry provider probes preserve every counter and expose only whole JSON state", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "release-registry-state-"));
  const statePath = path.join(directory, "state.json");
  let reader: ReturnType<typeof setInterval> | undefined;
  try {
    writeFakeNpmRegistry(directory);
    writeFileSync(statePath, JSON.stringify({ published: true, versionChecks: 0, tagChecks: 0 }));
    const readErrors: unknown[] = [];
    let reads = 0;
    reader = setInterval(() => {
      try {
        JSON.parse(fs.readFileSync(statePath, "utf8"));
        reads++;
      } catch (error) {
        readErrors.push(error);
      }
    }, 1);
    const name = "@vizejs/example";
    const version = "1.2.3";
    const results = await Promise.allSettled(
      Array.from({ length: 24 }, (_, index) => {
        const url = `https://registry.npmjs.org/%40vizejs%2Fexample${index % 2 ? "" : `/${version}`}?probe=${index}`;
        return promisify(execFile)(process.execPath, [path.join(directory, "curl"), url], {
          env: { ...process.env, NPM_FAKE_STATE_PATH: statePath, NPM_FAKE_VERSION: version },
        });
      }),
    );
    clearInterval(reader);
    reader = undefined;
    for (const [index, result] of results.entries()) {
      assert.equal(result.status, "fulfilled", `probe ${index} failed`);
      if (result.status !== "fulfilled") continue;
      const body =
        index % 2
          ? { name, "dist-tags": { latest: version, beta: version, rc: version } }
          : { name, version };
      assert.equal(result.value.stdout, `${JSON.stringify(body)}VIZE_HTTP_STATUS:200`);
      assert.equal(result.value.stderr, "");
    }
    assert.ok(reads > 0);
    assert.deepEqual(readErrors, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), {
      published: true,
      versionChecks: 12,
      tagChecks: 12,
    });
    // A tag probe finishing first must not borrow the version probe's counter
    // update to decide its own response. Exact version visibility is separate.
    writeFileSync(statePath, JSON.stringify({ publishCalls: 1, versionChecks: 2, tagChecks: 0 }));
    const tagFirst = await promisify(execFile)(
      process.execPath,
      [
        path.join(directory, "curl"),
        "https://registry.npmjs.org/%40vizejs%2Fexample?probe=tag-first",
      ],
      { env: { ...process.env, NPM_FAKE_STATE_PATH: statePath, NPM_FAKE_VERSION: version } },
    );
    assert.equal(
      tagFirst.stdout,
      `${JSON.stringify({ name, "dist-tags": { latest: version, beta: version, rc: version } })}VIZE_HTTP_STATUS:200`,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), {
      publishCalls: 1,
      versionChecks: 2,
      tagChecks: 1,
    });
  } finally {
    if (reader !== undefined) clearInterval(reader);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publish_npm_package computes the tag and forwards provenance to vp", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "release-publish-npm-"));
  const packageDir = path.join(tempDir, "pkg");
  const binDir = path.join(tempDir, "bin");
  const argsLogPath = path.join(tempDir, "vp-args.log");
  const cwdLogPath = path.join(tempDir, "vp-cwd.log");
  const registryUrlLogPath = path.join(tempDir, "registry-urls.log");
  const statePath = path.join(tempDir, "vp-state.json");

  try {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    writeFakeNpmRegistry(binDir);
    writeFileSync(
      path.join(packageDir, "package.json"),
      `${JSON.stringify({ name: "@vizejs/example", version: "1.2.3-beta.1" }, null, 2)}\n`,
    );
    writeFakeCommand(
      binDir,
      "vp",
      [
        "const fs = require('node:fs');",
        "const args = process.argv.slice(2);",
        "const state = fs.existsSync(process.env.VP_STATE_PATH)",
        "  ? JSON.parse(fs.readFileSync(process.env.VP_STATE_PATH, 'utf8'))",
        "  : { published: false };",
        "if (args[0] === 'pm' && args[1] === 'publish') {",
        "  fs.writeFileSync(process.env.VP_ARGS_LOG, args.join('\\n'));",
        "  fs.writeFileSync(process.env.VP_CWD_LOG, process.cwd());",
        "  state.published = true;",
        "  fs.writeFileSync(process.env.VP_STATE_PATH, JSON.stringify(state));",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'pm' && args[1] === 'view' && args[3] === 'version') {",
        "  if (state.published) {",
        "    process.stdout.write(JSON.stringify('1.2.3-beta.1'));",
        "    process.exit(0);",
        "  }",
        "  process.exit(1);",
        "}",
        "if (args[0] === 'pm' && args[1] === 'view' && args[3] === 'dist-tags') {",
        "  if (state.published) {",
        "    process.stdout.write(JSON.stringify({ beta: '1.2.3-beta.1' }));",
        "    process.exit(0);",
        "  }",
        "  process.exit(1);",
        "}",
        "process.exit(1);",
      ].join("\n"),
    );

    const result = runReleaseCommand("publish_npm_package", [packageDir, "--provenance"], {
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        VP_ARGS_LOG: argsLogPath,
        VP_CWD_LOG: cwdLogPath,
        VP_STATE_PATH: statePath,
        NPM_FAKE_STATE_PATH: statePath,
        NPM_FAKE_VERSION: "1.2.3-beta.1",
        NPM_FAKE_URL_LOG: registryUrlLogPath,
        PUBLISH_RESOLUTION_RETRY_LIMIT: "1",
        PUBLISH_RESOLUTION_RETRY_DELAY: "1",
      },
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`.trim());
    assert.deepEqual(fs.readFileSync(argsLogPath, "utf8").trim().split("\n"), [
      "pm",
      "publish",
      "--access",
      "public",
      "--no-git-checks",
      "--tag",
      "beta",
      "--",
      "--provenance",
    ]);
    assert.equal(fs.realpathSync(fs.readFileSync(cwdLogPath, "utf8")), fs.realpathSync(packageDir));
    const registryUrls = fs
      .readFileSync(registryUrlLogPath, "utf8")
      .trim()
      .split("\n")
      .map((url) => new URL(url));
    assert.equal(registryUrls[0].pathname, "/%40vizejs%2Fexample/1.2.3-beta.1");
    // Version and tag probes share one poll but can finish in either order.
    assert.deepEqual(
      registryUrls
        .slice(1)
        .map((url) => url.pathname)
        .sort(),
      ["/%40vizejs%2Fexample", "/%40vizejs%2Fexample/1.2.3-beta.1"],
    );
    const initialProbe = registryUrls[0].searchParams.get("vize-publish-check");
    const pollProbe = registryUrls[1].searchParams.get("vize-publish-check");
    assert.ok(initialProbe);
    assert.ok(pollProbe);
    assert.notEqual(initialProbe, pollProbe);
    assert.equal(pollProbe, registryUrls[2].searchParams.get("vize-publish-check"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
