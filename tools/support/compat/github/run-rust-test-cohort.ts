import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCargoMetadata } from "./plan-affected-rust.ts";
import type { CargoMetadata } from "./plan-affected-rust.ts";
import { rustCommand } from "./run-affected-rust.ts";
import { isRustTestCohort, rustTestCohortForBinary, rustTestMatrix } from "./rust-test-cohorts.ts";

type Target = {
  name: string;
  kind: string[];
  test: boolean;
  "required-features"?: string[];
};
type Package = { name: string; targets: Target[] };
type Projection = { args: string[]; reason?: string };
const libraryKinds = new Set(["lib", "rlib", "dylib", "staticlib", "cdylib", "proc-macro"]);
const ordinaryKinds = new Set(["bin", "test", "example", "bench", "custom-build"]);
const isLibrary = (target: Target) => target.kind.every((kind) => libraryKinds.has(kind));
const defaultTargets = (reason: string): Projection => ({ args: [], reason });

function selectedTargets(metadata: CargoMetadata, selected: readonly string[]): Package[] {
  return metadata.packages
    .filter((pkg) => metadata.workspace_members.includes(pkg.id) && selected.includes(pkg.name))
    .map((pkg) => {
      const targets: unknown = (pkg as unknown as Package).targets;
      if (!Array.isArray(targets) || !targets.length)
        throw new Error(`missing Cargo targets: ${pkg.name}`);
      const identities = new Set<string>();
      for (const target of targets as Target[]) {
        if (
          !target ||
          typeof target.name !== "string" ||
          !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(target.name) ||
          !Array.isArray(target.kind) ||
          !target.kind.length ||
          target.kind.some((kind) => typeof kind !== "string" || !kind) ||
          typeof target.test !== "boolean" ||
          (target["required-features"] !== undefined &&
            (!Array.isArray(target["required-features"]) ||
              target["required-features"].some(
                (feature) => typeof feature !== "string" || !feature,
              )))
        )
          throw new Error(`invalid Cargo target metadata: ${pkg.name}`);
        const identity = `${target.kind.join(",")}:${target.name}`;
        if (identities.has(identity))
          throw new Error(`duplicate Cargo target: ${pkg.name}:${identity}`);
        identities.add(identity);
      }
      return { name: pkg.name, targets: targets as Target[] };
    });
}

export function rustTestTargetProjection(
  metadata: CargoMetadata,
  selected: readonly string[],
  cohort: string,
): Projection {
  const matrix = rustTestMatrix(metadata, selected).include;
  if (!isRustTestCohort(cohort) || !matrix.some((entry) => entry.cohort === cohort)) {
    throw new Error(`Rust test cohort is not selected: ${cohort}`);
  }
  const packages = selectedTargets(metadata, selected);
  const targets = packages.flatMap((pkg) => pkg.targets);
  // Explicit --lib/--bins would override test=false. Unusual runnable target
  // kinds also retain Cargo's complete default selection, never silently drop.
  if (
    targets.some(
      (target) =>
        (!isLibrary(target) && (target.kind.length !== 1 || !ordinaryKinds.has(target.kind[0]))) ||
        ((isLibrary(target) || target.kind.includes("bin")) && !target.test) ||
        (target.test && !isLibrary(target) && !["bin", "test"].includes(target.kind[0])),
    )
  )
    return defaultTargets("nonstandard default test targets");

  const projections = new Map(
    matrix.map((entry) => {
      const names = [
        ...new Set(
          packages.flatMap((pkg) =>
            pkg.targets
              .filter(
                (target) =>
                  target.kind.includes("test") &&
                  target.test &&
                  rustTestCohortForBinary(pkg.name, target.name) === entry.cohort,
              )
              .map((target) => target.name),
          ),
        ),
      ].sort();
      // Cargo resolves --test names across every selected package. A duplicate
      // name must not force a disabled target or an unavailable required feature.
      // Retain Cargo's own resolver rather than guessing which features are active.
      const gated = targets.some(
        (target) =>
          target.kind.includes("test") &&
          names.includes(target.name) &&
          (!target.test || Boolean(target["required-features"]?.length)),
      );
      const args = [
        ...(targets.some(isLibrary) ? ["--lib"] : []),
        ...(targets.some((target) => target.kind.includes("bin")) ? ["--bins"] : []),
        ...names.flatMap((name) => ["--test", name]),
      ];
      const projection: Projection = gated
        ? defaultTargets("feature-gated or disabled integration targets")
        : args.length
          ? { args }
          : defaultTargets("no explicit test targets");
      return [entry.cohort, projection] as const;
    }),
  );
  // Default cargo test also compiles test=false examples. Keep that coverage
  // once, on an existing full-build cohort or the first selected cohort. No
  // extra job/command and no conversion of examples into runnable test harnesses.
  if (
    targets.some((target) => target.kind.includes("example")) &&
    ![...projections.values()].some((projection) => projection.reason)
  ) {
    projections.set(matrix[0].cohort, defaultTargets("retain default example compilation"));
  }
  return projections.get(cohort)!;
}

export function main(argv = process.argv.slice(2)) {
  const [planPath, cohort, ...options] = argv;
  if (!planPath || !cohort) throw new Error("expected Rust plan path and semantic cohort");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  // Validate the unchanged package roots before reading metadata or launching Cargo.
  rustCommand(plan, ["cargo", "nextest", "run", "@packages@"]);
  const projection = rustTestTargetProjection(readCargoMetadata(), plan.packages, cohort);
  process.stdout.write(
    `Cargo targets (${cohort}): ${projection.reason ?? `${projection.args.filter((arg) => arg === "--test").length} integration targets and shared unit targets`}\n`,
  );
  const [executable, ...args] = rustCommand(plan, [
    "cargo",
    "nextest",
    "run",
    "@packages@",
    ...projection.args,
    ...options,
  ]);
  const result = spawnSync(executable, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
