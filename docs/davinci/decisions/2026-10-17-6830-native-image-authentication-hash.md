# Optimize the CI native image hash

Issue: #6830. The original Vben incremental test failed its unchanged
1,500 ms second-app cold-open budget in full qualification
[38988499789](https://github.com/ubugeeei-prod/vize/actions/runs/38988499789)
at source `e2b883eed6378eb7ada73bf0220d89a185a3d6fd`.

The instrumented [run 38990136719](https://github.com/ubugeeei-prod/vize/actions/runs/38990136719)
at `bd7c444d398baf5abc337fd32b776e5dab2d2e35` reproduced the failure at
1,961.16 ms on the same pinned fixture, Blacksmith 32-vCPU runner class,
`profile.ci` and budget scale 1. The Vben session performed six complete
native-image authentication calls before failing. Its final two SHA-256
phases took 323.03 and 322.17 ms (645.21 ms total); their file reads took
4.39 ms combined and each complete initialize comparison about 0.05 ms.
Every decision accepted the same 24,101,026-byte native image with SHA-256
`4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4`.
Nested phase durations are not added to their enclosing decision durations.

`profile.ci` inherits dev's opt0. A version-scoped package override now
builds the already pinned `sha2:0.11.1` at opt3, explicitly retaining debug
assertions and overflow checks. The SHA-256 compression loop belongs to
this dependency; its existing runtime CPU detection and software fallback
remain intact. The other locked SHA-2 version, local dev profile, product
crate optimization levels and release profiles are unchanged.

Authentication still compares the whole initialized response and reads and
hashes every executable byte for each session, immediately after initialize.
There is no path/stat cache, shortened digest, deferred authentication or
new provider. The original shutdown behavior, test fixtures and budgets are
unchanged. The dependency and its consumers need an initial Cargo rebuild;
normal profile fingerprints govern subsequent reuse.

Workspace qualification accepts only this exact version-scoped CI package
override, with all three fields present and both runtime checks enabled, or
no package override. Other package/version keys, extra fields, global or build
overrides, Cargo config and environment overrides remain refused. The actual
manifest and mutated copies exercise this boundary; source-file digests and
complete inventory/execution receipt checks remain unchanged.

Local validation parses the workspace and checks the exact dependency pin
without compiling. Optimized hosted acceptance is pending: retain the same
physical image digest, inspect emitted dependency/product profiles, and run
the complete original incremental tests against their existing budgets.
The diagnostic phases are excluded from this change. No optimized latency
result is claimed by the baseline measurement.
