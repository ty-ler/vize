# Use inexpensive profiles for correctness checks

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The maintainer requested cheaper CI compilation while retaining full
optimization for production. The existing native `ci` profile already used
the unoptimized development profile. Make its zero optimization and disabled
LTO explicit, and use it consistently for Clippy, native navigation and
feature tests so these jobs do not also populate a debug-symbol-heavy
`target/debug` dependency tree.

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
