import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { rekaUiApp, CORSA_BIN, VIZE_BIN, requireVizeAndCorsaBins } from "../../_helpers/apps.ts";
import { assertSnapshot } from "../../_helpers/snapshot.ts";
import { runVizeCheckJson, stringifyDiagnosticSnapshot } from "../../_helpers/vize-check.ts";
import {
  assertPinnedFixtureFiles,
  readPinnedFixtureSource,
} from "../../_helpers/pinned-fixture-source.ts";
import { rekaFixturePin } from "../../_helpers/reka-check-prepare.ts";
import { inspectRekaProviders } from "../../_helpers/reka-check-providers.ts";
import { retainAppCheckPacket } from "../../_helpers/app-check-packet.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(__dirname, "__snapshots__");
const app = rekaUiApp;

describe(`${app.name} check (type checker)`, () => {
  before(requireVizeAndCorsaBins);

  it("vize check does not crash and snapshot matches", () => {
    const checkConfig = app.check!;
    const patterns = checkConfig.patterns.map((p) => `'${p}'`).join(" ");
    const cmd = `${VIZE_BIN} check ${patterns} --format json --quiet --corsa-path '${CORSA_BIN}'`;
    console.log(`Running: ${cmd}`);

    let stdout: string;
    try {
      stdout = execSync(cmd, {
        cwd: checkConfig.cwd,
        timeout: 300_000,
        maxBuffer: 100 * 1024 * 1024,
      }).toString();
    } catch (e: any) {
      if (e.status === 1 && e.stdout) {
        stdout = e.stdout.toString();
      } else {
        throw new Error(`vize check crashed (exit code ${e.status}): ${e.stderr?.toString()}`);
      }
    }

    const parsed = JSON.parse(stdout);
    retainAppCheckPacket({
      name: app.name,
      stdout,
      parsed,
      cwd: checkConfig.cwd,
      command: cmd,
      argv: [
        VIZE_BIN,
        "check",
        ...checkConfig.patterns,
        "--format",
        "json",
        "--quiet",
        "--corsa-path",
        CORSA_BIN,
      ],
    });
    console.log(`fileCount=${parsed.fileCount}, errorCount=${parsed.errorCount}`);
    assert.ok(parsed.fileCount > 0, "fileCount should be > 0");

    const prettyOutput = stringifyDiagnosticSnapshot(parsed, checkConfig.cwd);
    assertSnapshot(SNAPSHOT_DIR, `${app.name}-check`, prettyOutput);
  });
});

// PinInputValue accepts number[] only for an explicitly numeric input. Exercise
// the public component import in the original pinned project's strict config.
const pinInputCases = [
  { name: "default-text-string", value: "string", type: undefined, expected: [] },
  { name: "explicit-number-number", value: "number", type: "number", expected: [] },
  {
    name: "explicit-number-string",
    value: "string",
    type: "number",
    expected: [
      "error:9:5 [TS2322] Type 'string[]' is not assignable to type 'number[]'.\nType 'string' is not assignable to type 'number'.",
    ],
  },
  {
    name: "explicit-text-number",
    value: "number",
    type: "text",
    expected: [
      "error:9:5 [TS2322] Type 'number[]' is not assignable to type 'string[]'.\nType 'number' is not assignable to type 'string'.",
    ],
  },
] as const;

describe("reka-ui PinInput public component contract", () => {
  before(requireVizeAndCorsaBins);

  for (const testCase of pinInputCases) {
    it(testCase.name, () => {
      const cwd = fs.realpathSync(app.check!.cwd);
      const authored = readPinnedFixtureSource(cwd, rekaFixturePin);
      assertPinnedFixtureFiles(cwd, authored);
      function providers() {
        const files: Array<{ file: string; role: string; sha256: string }> = [];
        const state = inspectRekaProviders(cwd, (file, role) => {
          files.push({
            file,
            role,
            sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          });
        });
        return { state, files };
      }
      const publicContract = authored.blobs.filter((entry) =>
        entry.path.startsWith("packages/core/src/PinInput/"),
      );
      const beforeProviders = providers();
      function images() {
        return [VIZE_BIN, CORSA_BIN].map((file) => ({
          file,
          physical: fs.realpathSync(file),
          sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        }));
      }
      const beforeImages = images();
      const relative = `packages/core/src/PinInput/story/__vize_pininput_${testCase.name}__.vue`;
      const file = path.join(cwd, relative);
      const source = [
        '<script setup lang="ts">',
        'import { ref } from "vue"',
        'import { PinInputRoot } from ".."',
        `const value = ref<${testCase.value}[]>([])`,
        "</script>",
        "",
        "<template>",
        "  <PinInputRoot",
        '    v-model="value"',
        ...(testCase.type ? [`    type="${testCase.type}"`] : []),
        "  />",
        "</template>",
        "",
      ].join("\n");
      const name = `reka-pininput-${testCase.name}`;
      fs.writeFileSync(file, source, { flag: "wx" });
      try {
        const parsed = runVizeCheckJson(cwd, [relative], {
          timeoutMs: 300_000,
          tsconfig: app.check!.tsconfig,
          showVirtualTs: true,
          allowExitCodes: testCase.expected.length ? [1] : [0],
          spawnSync(command, args, options) {
            const startedAt = performance.now();
            const result = spawnSync(command, args, options);
            const durationMs = performance.now() - startedAt;
            const stdout = result.stdout ?? "",
              stderr = result.stderr ?? "";
            let report: unknown;
            try {
              report = JSON.parse(stdout);
            } catch {
              report = {};
            }
            retainAppCheckPacket({
              name,
              stdout,
              parsed: report,
              cwd,
              command: JSON.stringify([command, ...args]),
              argv: [command, ...args],
            });
            const capture = process.env.VIZE_APP_CHECK_CAPTURE_DIR;
            if (capture) {
              const directory = path.join(capture, name);
              fs.writeFileSync(path.join(directory, "input.vue"), source);
              for (const entry of publicContract) {
                const destination = path.join(directory, "public-source", entry.path);
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.copyFileSync(path.join(cwd, entry.path), destination);
              }
              fs.writeFileSync(path.join(directory, "stderr.txt"), stderr);
              fs.writeFileSync(
                path.join(directory, "process.json"),
                JSON.stringify(
                  {
                    command,
                    args,
                    cwd,
                    durationMs,
                    timeoutMs: 300_000,
                    status: result.status,
                    signal: result.signal,
                    error: result.error?.message ?? null,
                    sourcePin: rekaFixturePin,
                    publicContract,
                    sourceInventorySha256: authored.inventorySha256,
                    beforeProviders,
                    beforeImages,
                  },
                  null,
                  2,
                ) + "\n",
              );
            }
            assert.ok(
              durationMs < 300_000,
              "PinInput command exceeded its original control budget",
            );
            assert.equal(result.signal, null);
            return result;
          },
        });
        const target = parsed.files.find((entry) => entry.file === relative);
        assert.ok(target, "the actual component contract input must be checked");
        assert.ok(parsed.fileCount > 0);
        assert.deepEqual(target.diagnostics, testCase.expected);
        assert.equal(parsed.errorCount, testCase.expected.length);
        assert.equal(parsed.warningCount, 0);
      } finally {
        const observed = fs.readFileSync(file);
        fs.unlinkSync(file);
        assert.deepEqual(
          observed,
          Buffer.from(source),
          "native check changed its owned component input",
        );
        assertPinnedFixtureFiles(cwd, authored);
        assert.deepEqual(
          providers(),
          beforeProviders,
          "native check changed the strict pinned providers",
        );
        assert.deepEqual(images(), beforeImages, "native or SDK image changed during the control");
      }
    });
  }
});
