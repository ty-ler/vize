import { qualifyPathHostMove } from "./warm-type-backed-path-host.ts";
import { qualifyTimingHostMove } from "./warm-type-backed-timing-host.ts";
import { qualifyDefaultMigrationHost } from "./warm-type-backed-default-migration-host.ts";
import { qualifyGraphHost } from "./warm-type-backed-graph-host.ts";
import { qualifyDiagnosticHost } from "./warm-type-backed-diagnostic-host.ts";
import { qualifyInlineBucketHost } from "./warm-type-backed-inline-bucket-host.ts";

/** Compose finite qualifications without changing existing path/timing authorities. */
export function qualifyHostMoves(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  enabled: boolean,
  digest: (side: "before" | "after", file: string) => string | null,
) {
  const graphHost = enabled ? qualifyGraphHost(production, digest) : null;
  const diagnosticHost = enabled ? qualifyDiagnosticHost(production, digest) : null;
  const inlineBucketHost = enabled ? qualifyInlineBucketHost(production, digest) : null;
  return {
    ...(graphHost ? { graphHost } : {}),
    ...(diagnosticHost ? { diagnosticHost } : {}),
    ...(inlineBucketHost ? { inlineBucketHost } : {}),
    pathHostMove: enabled ? qualifyPathHostMove(production, alreadyQualified, digest) : null,
    timingHostMove: enabled ? qualifyTimingHostMove(production, alreadyQualified, digest) : null,
    defaultMigrationHost: enabled
      ? qualifyDefaultMigrationHost(production, alreadyQualified, digest)
      : null,
  };
}
