import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  workersSourceIdentity,
  workersCheckoutIdentity,
  workersBuildProducerIdentity,
  retainWorkersGeneratedBytes,
  verifyWorkersGeneratedBytes,
} from "./navigation-render-workers-custody.ts";
import { packet, qualifyWorkersPair } from "./navigation-render-workers-evidence.ts";

export async function qualifyNavigationRenderWorkers() {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      dir: { type: "string", default: "docs/dist" },
      output: { type: "string" },
      "baseline-outcome": { type: "string" },
      "candidate-outcome": { type: "string" },
    },
  });
  assert(
    ["checkout", "prepare", "qualify"].includes(values.phase ?? ""),
    "Explicit checkout/prepare/qualify phase required",
  );
  assert(values.output, "Fresh owned output directory required");
  const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const dist = path.resolve(values.dir);
  const output = path.resolve(values.output);
  const source = process.env.GITHUB_SHA;
  assert(source, "Actual Actions source identity is required");
  if (values.phase === "checkout") {
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output); // An existing directory must never supply old receipts.
    const identity = await workersCheckoutIdentity(root, source);
    const producers = await workersBuildProducerIdentity(root);
    await retainWorkersGeneratedBytes(root, output, "inputs");
    await writeFile(
      path.join(output, "source-before-build.json"),
      JSON.stringify({ schemaVersion: 1, identity, producers }, null, 2) + "\n",
    );
    return;
  }
  let report: unknown;
  try {
    const prebuild = packet(
      JSON.parse(await readFile(path.join(output, "source-before-build.json"), "utf8")),
    );
    assert.equal(prebuild.schemaVersion, 1);
    const checkout = prebuild.identity as Awaited<ReturnType<typeof workersCheckoutIdentity>>;
    const identity = await workersSourceIdentity(root, dist, source, checkout);
    assert.deepEqual(prebuild.producers, identity.buildProducers, "Actual build producer changed");
    if (values.phase === "prepare") {
      await retainWorkersGeneratedBytes(root, output, "outputs");
      await verifyWorkersGeneratedBytes(output, identity.generated);
      await writeFile(
        path.join(output, "source-before.json"),
        JSON.stringify({ schemaVersion: 1, identity }, null, 2) + "\n",
      );
      return;
    }
    await verifyWorkersGeneratedBytes(output, identity.generated);
    const before = packet(
      JSON.parse(await readFile(path.join(output, "source-before.json"), "utf8")),
    );
    assert.equal(before.schemaVersion, 1);
    await writeFile(
      path.join(output, "source-after.json"),
      JSON.stringify({ schemaVersion: 1, identity }, null, 2) + "\n",
    );
    assert.deepEqual(
      before.identity,
      identity,
      "Full physical source/dist/library/browser/font custody changed between arms",
    );
    assert.equal(values["baseline-outcome"], "success", "Original two-worker command must succeed");
    assert.equal(values["candidate-outcome"], "success", "Four-worker command must succeed");
    report = await qualifyWorkersPair(
      path.join(output, "workers-2"),
      path.join(output, "workers-4"),
      { source, dist, sourceFiles: identity.sourceFiles },
    );
  } catch (error) {
    report = {
      schemaVersion: 1,
      source,
      status: "failed",
      baselineOutcome: values["baseline-outcome"],
      candidateOutcome: values["candidate-outcome"],
      error: error instanceof Error ? error.stack : String(error),
    };
    throw error;
  } finally {
    if (values.phase === "qualify" || report !== undefined) {
      await mkdir(output, { recursive: true });
      await writeFile(
        path.join(output, "qualification.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await qualifyNavigationRenderWorkers();
