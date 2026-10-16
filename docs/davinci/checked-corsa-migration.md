# Checked Corsa compatibility graph

Vize needs observable native process termination and a snapshot owner that keeps
configuration, sources and protocol handles together. The stable Corsa 1.14.2
binding does not expose the process observer required for those checks. The six
packages under `vendor/corsa*` provide a compatibility preview with the original
Rust library names and existing default/distributed features.

This migration does not claim that upstream Corsa, registry consumers, release
artifacts or all real applications have passed. Source checks, native behavior,
independent package consumers, controlled performance and public release
acceptance are separate results.

## Source and dependency identity

The starting lockfile uses Corsa, LSP and orchestrator 1.14.0, with core, JSON-RPC,
client and runtime 1.14.2. Preserve that mixed graph: replacing every package with
1.14.0 would remove current client APIs. Runtime remains the unmodified registry
`corsa_runtime` 1.14.2. All six owned packages share the Vize workspace version and
keep the `corsa*` library names. Their package names become `vize_corsa*`.

`vendor/corsa-source.tsv` records every imported member, published archive SHA256,
upstream version, exact member size and SHA256, and whether it is unchanged
upstream source, a checked overlay, an owned manifest or a retained license. The
source verifier checks the complete inventory and six full MIT notices. It does
not constrain unrelated Vize source or require a finite Git history.

The facade's upstream allocation policy originally refers to its monorepo. Its
complete original test remains in `tests/data/upstream_policy.rs.txt`. The active
test checks all 13 imported fast-module paths and the actual Cargo-resolved
registry runtime's broadcast module. The five upstream `corsa_ref` CLI-tool
paths are outside this six-package dependency graph and are not shipped; their
historical policy remains in that original file. The original native baseline
JSON and optional upstream dataset/backend conditions remain unchanged; only
its packaged fixture path is relative to the actual facade manifest. Separate
required Vize native laws provide actual product acceptance.

The overlays add owned-process observations, acknowledged shutdown and bounded
reaping. Only an authenticated native 7.0.2 executable and complete initialize
contract select shutdown followed by stdin EOF. Foreign servers retain standard
shutdown/exit. No stderr bytes, including the historical EOF line, are discarded.
A clean result requires one completed successful terminal receipt and an
acknowledged graceful shutdown. Startup failure and discard retain raw evidence.

Package identities are nominal Rust types: applications exchanging Corsa types
must consistently use the owned graph. Mixing upstream and owned providers is
not a supported migration. No consumer-side Cargo patch is required.

## Independent acceptance

The native Actions retain existing snapshot, projection, syntax/semantic and LSP
laws. They additionally run the frozen full diagnostic vector and repaired input
against the actual native process; the batch receipt borrows the same retained
snapshot attachment used for diagnostics. CLI controls retain unexpected stderr,
non-UTF8 bytes, nonzero status, signal termination and forced timeout evidence.
Concurrent rename sessions verify their actual child termination.

`checked-corsa-package-consumer.py` assembles all six normalized Cargo archives
and checks complete source membership and licenses. Archive assembly with
`--no-verify` is explicitly not compilation acceptance. Separate independent
consumers build and test both path providers and sealed archive providers with
default and distributed features. They do not patch dependencies. CLI feature
metadata checks isolate default, minimal, Glyph, Maestro and all features from
workspace-wide feature unification. All compilation uses the worker's shared
`ci` target. The archive consumer is offline and is not a public-registry test.

The original 400-module performance source-pair mode retains both full
manifests/locks and metadata. It admits only the structural six-provider
migration, preserves unrelated dependencies and the actual runtime, and demands
fresh compilation of all six provider libraries on each side. It keeps the
existing workload packets, invalidation controls and numerical ceilings. A source
pair does not replace public release qualification.

## Publication plan and current prerequisites

Read-only crates.io queries on 2026-10-16 returned HTTP 404 for all six owned
package names. There are no published versions or owners to inspect. This is
not proof that a future authenticated first publication will be permitted. No
names have been registered and no crates have been published by this change.

The existing release catalog remains unchanged while release PR #9196 is open.
The manifest resolver is prepared for the six vendor paths; adding the packages
to the ordered publisher catalog is a separate release coordination step. The
local workspace version is preparation, not a public-release promise. Per the
pre-1.0 release policy, ship the migration in a new minor release after the
existing release finishes.

After source and package/native Actions pass:

1. Confirm the publication identity and ability to create the six namespaces;
   report any actual registry authentication or ownership rejection verbatim.
2. Add the six packages to the publisher catalog before their consumers, in
   dependency order: core, JSON-RPC, client, LSP, orchestrator, facade. Preserve
   existing runtime 1.14.2 rather than republishing it.
3. Publish the new minor's six packages before Canon and other Vize consumers.
   Preserve full upstream notices and archive provenance. Verify each exact
   published package/version and owner configuration.
4. Build a fresh registry-only consumer with no paths, patches or workspace
   dependency source. Require default and distributed builds/tests, CLI feature
   parity and one runtime provider. Archive/path acceptance cannot satisfy this.
5. Run the release's unchanged original performance and application/editor
   qualification against the immutable release identity, then verify public
   installations. Keep the original #8675 failure evidence until every claimed
   replacement result is independently available.

No upstream comments, changes or namespace operations are necessary to review
this source migration. An actual publication failure is a concrete release
blocker; the read-only 404 result alone is not an authorization request.
