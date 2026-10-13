# Use inexpensive profiles for correctness checks

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The maintainer requested cheaper CI compilation while retaining full
optimization for production. The existing native `ci` profile already used
the unoptimized development profile. Make its zero optimization and disabled
LTO explicit, and use it consistently for Clippy, native navigation and
feature tests so these jobs do not also populate a debug-symbol-heavy
`target/debug` dependency tree.

Native CI also installs the named `1.99.0` toolchain already required by
rust-toolchain.toml, instead of the separate `stable` alias. In
[job 115368234971](https://github.com/ubugeeei-prod/vize/actions/runs/38417890925/job/115368234971),
setup installed `stable`, then Cargo downloaded `1.99.0` again and timed out
fetching its manifest. A regression check keeps the native CI setup aligned
with the repository pin. Nightly instrumentation remains on nightly.

Playground browser checks previously compiled the WASM crate with the same
fat LTO, optimization level 3 and single codegen unit as published packages.
They now use `ci-wasm`: optimization level 1, no LTO, 256 codegen units and
abort-on-panic. The browser assertions, selected suites and failure handling
remain the same. The profile has its own Cargo output directory, and the
existing WASM cache key includes both Cargo.toml and the changed builder.

The builder defaults to `release`; public documentation and npm packages
continue to use that default. Native releases retain optimization level 3,
fat LTO and one codegen unit. Existing performance jobs retain `ci-opt` and
their paired build settings. Correctness-build timings are not production
performance measurements.

Regression tests execute the builder with recording subprocesses to verify
profile selection, artifact paths, default release behavior and early failure.
Actions runs the actual native and browser checks. Build-time improvement
will be reported from completed Actions steps, separately from the expected
reduction in optimization work.

Deliver this change after the mold migration in the same native Stack. Both
changes touch the same setup steps; the combined version retains the pinned
toolchain, mold and the cheaper CI profiles without restoring retired checks.

The paired 400-provider benchmark retains raw manifests and hashes for both
sources. Its comparison permits differences in CI profiles only when the
selected benchmark profile does not inherit them. Dependencies, lockfiles,
toolchains and all selected release settings must still match; tests reject
changes to each and to indirectly inherited CI settings. Both preparation and
the final packet comparison use this check. Each side must also retain its
complete raw source identity from the attested build through execution.
