# Verify newly published JSR versions immediately

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

Release v0.457.0 [run 38805261385](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385)
published its primary artifacts but remained failed because the
[Deno consumer](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385/job/116687943513)
rejected the newly published JSR version. At 2026-10-15T21:45:19Z, Deno 2.9.7
reported that version 0.457.0 existed but was newer than its minimum dependency
date, 2026-10-14T21:45:19Z. This was a dependency age rejection, not a missing
publication or propagation delay.

[Deno's configuration reference](https://docs.deno.com/runtime/reference/deno_json/#minimum-dependency-age)
documents the default 24-hour minimum and package-specific exceptions through
`minimumDependencyAge: { age, exclude }`. The release consumer must verify the
version just published. Both Deno consumers therefore copy the single
`tools/support/release/jsr/consumer-deno.json` into their temporary project and
load it explicitly with `--config`. It retains `age: "P1D"` for external
dependencies and exempts exactly 13 package names: the JSR facade, four npm
packages (`vize`, native, Vite plugin, unplugin), and eight native binaries.
No prefix wildcards or command-wide age override are used.

The same configuration sets `nodeModulesDir: "none"` so Deno resolves packages
through its own cache. The published consumer's empty `package.json`, shared
with Node/Bun setup, otherwise makes Deno use a manual `node_modules` directory
and reject the uninstalled npm dependencies. A fresh Deno 2.9.7 reproduction
with that exact project shape verifies the explicit cache mode.

Exempting only `jsr:@vizejs/vize` is insufficient. With the official Deno 2.9.7
binary, a fresh consumer and an empty `DENO_DIR`, that configuration rejects
`npm:vize@0.457.0` imported by the facade. The same unchanged consumer succeeds
with the 13 explicit exceptions, still importing the published JSR package and
executing its native compiler. Each case starts without a lockfile or cached
resolution. Deno's exceptions match package names; the existing exact-version
JSR import and generated npm facade specifiers still select the release.

The command still imports the exact `jsr:@vizejs/vize@${JSR_VERSION#v}` version.
The source checkout, enabled-channel gate, publication dependencies, fresh
consumer directory, registry imports, and existing consumer assertions remain
unchanged. No repository-wide dependency age policy, Node/Bun command, package
version, publication operation, or existing release receipt is changed.

The package test derives the expected exception set from the facade entry
points and their production dependency manifests. Missing or extra exceptions,
including wildcards and third-party packages, fail the test. New workspace
dependencies require an explicit review of that closure. Workflow contracts
require both Deno consumers to load the shared configuration and keep it out
of Node/Bun steps. Their install and consumer commands remain unchanged.
The next hosted JSR package check and
release consumer still supply the Actions acceptance results; local success
does not establish that a release passed.

The first repair PR's [JSR package check](https://github.com/ubugeeei-prod/vize/actions/runs/38882495127/job/116912317020)
failed before reaching Deno: its workflow contract test imports `yaml`, but the
job had never installed the declared tooling dependencies. Local validation
used an existing `node_modules` and did not expose that missing prerequisite.
Set up Vite+ and install only the root `vize-workspace` dependency graph from the
frozen lockfile before those tests. Lifecycle scripts remain disabled, and no
product build is added.

The staged consumer also resolves the generated facade's exact npm versions
and needs the same exceptions. The generated `jsr.json` already sets
`minimumDependencyAge: 0` for publication, but the separate consumer script
does not load that configuration. Publication behavior remains unchanged;
the shared consumer configuration governs only the two Deno consumer runs.
