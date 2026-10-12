import assert from "node:assert/strict";
import { assertNativeTerminalLocks } from "./warm-type-backed-native-terminal-host.ts";
import { qualifyNativeTerminalHost } from "./warm-type-backed-native-lexical-composition-host.ts";
import { gitBodyDigest } from "./warm-type-backed-path-host.ts";
import { reviewedHostPaths } from "./warm-type-backed-reviewed-hosts.ts";
import { driverRoot } from "./warm-type-backed-source.ts";
import { qualifyNativeProxyHost } from "./warm-type-backed-native-proxy-host.ts";
import { assertNativeProxyFinalFixtureReceipt } from "./warm-type-backed-native-proxy-final-body.ts";

type Binding = {
  production: string[];
  baseline: string;
  head: string;
  nativeTerminalHost?: ReturnType<typeof qualifyNativeTerminalHost>;
  nativeProxyHost?: ReturnType<typeof qualifyNativeProxyHost>;
};

/** Reauthenticate the complete reviewed source at final original400 comparison. */
export function assertFinalNativeTerminalLocks(
  binding: Binding,
  before: Record<string, string>,
  after: Record<string, string>,
) {
  const allowed = new Set(reviewedHostPaths);
  const fixture = qualifyNativeProxyHost(binding.production, allowed, (side, file) =>
    gitBodyDigest(driverRoot, side === "before" ? binding.baseline : binding.head, file),
  );
  assertNativeProxyFinalFixtureReceipt(fixture, binding.nativeProxyHost);
  for (const file of fixture.files) allowed.add(file);
  const qualified = qualifyNativeTerminalHost(binding.production, allowed, (side, file) =>
    gitBodyDigest(driverRoot, side === "before" ? binding.baseline : binding.head, file),
  );
  assert.deepEqual(qualified, binding.nativeTerminalHost ?? null);
  assertNativeTerminalLocks(before, after, qualified);
}
