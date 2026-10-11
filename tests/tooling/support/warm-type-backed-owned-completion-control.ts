import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fixtureRoot,
  object,
  originalPackets,
  readFixture,
  successorPackets,
  type ObservedPair,
} from "../../performance/support/warm-type-backed-owned-completion-fixture.ts";
import type { runOwnerResolveFixture } from "../../performance/support/warm-type-backed-owner-resolve.ts";
import {
  ownedCompletionManifest,
  ownedCompletionManifestSHA256,
} from "../../performance/support/warm-type-backed-owned-completion-host.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-owned-completion-fixture-"));
process.on("exit", () => fs.rmSync(directory, { recursive: true, force: true }));
const sourceDirectory = path.join(directory, "authored-source");
fs.mkdirSync(sourceDirectory);
const generator = path.join(sourceDirectory, "gen.mjs");
fs.copyFileSync(
  new URL("../../_fixtures/differential/lsp/warm-type-backed-requests/gen.mjs", import.meta.url),
  generator,
);
const generated = spawnSync(process.execPath, [generator, "400"], {
  cwd: sourceDirectory,
  encoding: "utf8",
});
assert.equal(generated.status, 0, generated.stderr);
const source = Object.fromEntries(
  ["c", "lib"].flatMap((name) =>
    fs
      .readdirSync(path.join(sourceDirectory, "src", name))
      .toSorted()
      .map((file) => [
        `src/${name}/${file}`,
        fs.readFileSync(path.join(sourceDirectory, "src", name, file), "utf8"),
      ]),
  ),
);
type Witness = {
  side: "before" | "after";
  stage: string;
  requestId: number;
  authored: unknown;
  requestPosition: unknown;
  root: string;
  virtualFile: string;
  virtualBody: string;
  virtualSHA256: string;
  configBody: string;
  configSHA256: string;
};
export function control() {
  const pair = {
    sourceBinding: {
      baseline: "67e3d0e6775cc3a1f29bfb9309d991252f9e75ff",
      head: "e4be66d676dbbb9f97fff8f7f718fc5bad9b3b19",
      projectConfigHost: {
        ownedCompletionContext: {
          manifestSHA256: ownedCompletionManifestSHA256,
          fixtureManifestSHA256: ownedCompletionManifest.fixtureManifestSHA256,
        },
      },
    },
  } as ObservedPair;
  for (const side of ["before", "after"] as const) {
    const ownership = readFixture<{
      sessionRoots: ObservedPair["before"]["sessionRoots"];
      events: Array<Record<string, unknown>>;
      projections: Array<Record<string, unknown>>;
    }>(`${side}-ownership.json`);
    const raw = (value: unknown): unknown => {
      if (typeof value === "string") {
        for (const [index, root] of ownership.sessionRoots.physical.entries())
          value = value.replaceAll(`$EDITOR_SESSION_${index + 1}/`, `${root}/`);
        return value;
      }
      if (Array.isArray(value)) return value.map(raw);
      if (value !== null && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, raw(item)]));
      return value;
    };
    const packets = structuredClone(
      side === "before"
        ? originalPackets
        : originalPackets.map(
            (row) => successorPackets.find((entry) => entry.requestId === row.requestId) ?? row,
          ),
    );
    const capture = path.join(directory, side);
    fs.mkdirSync(capture, { recursive: true });
    fs.copyFileSync(new URL(`${side}-client.bin`, fixtureRoot), path.join(capture, "client.bin"));
    pair[side] = {
      sessionRoots: ownership.sessionRoots,
      changedInputs: ownership.events,
      source: {
        revision:
          side === "before"
            ? "67e3d0e6775cc3a1f29bfb9309d991252f9e75ff"
            : "e4be66d676dbbb9f97fff8f7f718fc5bad9b3b19",
      },
      inputs: { source },
      wire: { capture },
      rows: packets.map((row) => ({
        ...row,
        params: raw(row.params),
        response: raw(row.response),
        comparableParams: row.params,
        comparableResponse: row.response,
        result: object(raw(row.response)).result,
      })),
    };
    for (const witness of readFixture<Witness[]>("native-witnesses.json").filter(
      (entry) => entry.side === side,
    )) {
      const row = pair[side].rows.find((entry) => entry.requestId === witness.requestId)!;
      row.ownerMigration = {
        ...ownership.projections.find((entry) => entry.stage === witness.stage),
        authored: witness.authored,
        requestPosition: witness.requestPosition,
        files: [
          {
            file: witness.virtualFile,
            code: fs.readFileSync(new URL(witness.virtualBody, fixtureRoot), "utf8"),
            sha256: witness.virtualSHA256,
          },
          {
            file: `${witness.root}/tsconfig.json`,
            code: fs.readFileSync(new URL(witness.configBody, fixtureRoot), "utf8"),
            sha256: witness.configSHA256,
          },
        ],
      };
    }
  }
  const resolved = ["before", "after"].map((side) => ({
    ...readFixture<{ additional: unknown[]; refusalFailures: string[] }>(
      `${side}-resolve-proof.json`,
    ),
    input: { source: structuredClone(source) },
    rows: readFixture<{ rows: unknown[] }>(`${side}-resolve-issuers.json`).rows,
    failure: undefined,
  })) as Array<Awaited<ReturnType<typeof runOwnerResolveFixture>>>;
  return { pair, resolved };
}
