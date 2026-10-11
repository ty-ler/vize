import { control } from "./warm-type-backed-owned-completion-control.ts";
import { object } from "../../performance/support/warm-type-backed-owned-completion-fixture.ts";
import {
  componentOwnedManifest,
  componentOwnedManifestSHA256,
  type ComponentOwnedScope,
} from "../../performance/support/warm-type-backed-component-owned-completion-host.ts";

export function componentControl(scope: ComponentOwnedScope) {
  const value = control();
  object(value.pair.sourceBinding).componentContextHost = {
    ownedCompletionContext: {
      manifestSHA256: componentOwnedManifest.nativeManifestSHA256,
      fixtureManifestSHA256: componentOwnedManifest.fixtureManifestSHA256,
      scope,
    },
    componentOwnedCompletionContext: {
      manifestSHA256: componentOwnedManifestSHA256,
      nativeManifestSHA256: componentOwnedManifest.nativeManifestSHA256,
      fixtureManifestSHA256: componentOwnedManifest.fixtureManifestSHA256,
      scope,
    },
  };
  if (scope === "inherited") {
    value.pair.before = structuredClone(value.pair.after);
    value.pair.before.source.revision = value.pair.sourceBinding.baseline =
      "bf2cd1632e7b743c71df5bf5af588eb1d02a01c1";
    value.resolved[0] = structuredClone(value.resolved[1]);
  }
  return value;
}
