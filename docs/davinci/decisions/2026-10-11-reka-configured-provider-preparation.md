# Original ReKa configured provider preparation

Issue: [#6879](https://github.com/ubugeeei-prod/vize/issues/6879).
Paired decision: [issue comment](https://github.com/ubugeeei-prod/vize/issues/6879#issuecomment-6109906807).
Companion: [generic-call inference and configured replay](./2026-10-11-6879-generic-call-inference.md).

## Decision

Prepare the original ReKa Gitlink `c23e0ed8a38c66cd4f9350e7a46c6b502a8491c2`
before both the unchanged complete App check row and the existing native PinInput
replay. The shared App row invokes this preparation only for check suites, after
the repository's JavaScript dependency installation. All current check planner
rows hydrate ReKa. No second Rust build, new workflow, narrowed App glob, edited
diagnostic golden, authored config replacement, or provider stub is introduced.

The authored package manager is `pnpm@10.13.1`. Install its complete workspace
with `--frozen-lockfile --ignore-scripts --prefer-offline`. The original root
`prepare` hook is exactly `pnpm simple-git-hooks`; it installs Git hooks and
produces no required language source. Refuse an unexpected hook. Preserve every
tracked file, mode and Git blob, including the original lockfile and workspace
manifest. Retain unauthorized writes before restoring them and fail preparation.

Bind the caller's actual Node executable and separately authenticate npm's real
`npx-cli.js`, because Actions can provide a bare Node distribution. Execute npm
with that literal Node and the existing command-shell runtime binding, so npm's
ancestor `.bin` prefixes cannot substitute a different child runtime. Record
Node's executable/version/hash and npm's path/version/bytes before installation;
require their identities to remain unchanged afterward. Nuxt's stricter adjacent
npx requirement and its fourteen original tooling laws remain intact.

## Provider and configuration custody

Require the fixture-owned root TypeScript and core-local Vue/config providers,
with versions and requests matching the unchanged lock importers. An ancestor
provider cannot cover a missing core provider. Record logical and physical paths
for all original scopes mirrored by native `install.rs`, including core and
`.histoire`; do not substitute the visual app's independently patched worktree.

The pinned versions are TypeScript 5.8.3, Vue 3.5.17 and `@vue/tsconfig` 0.7.0.
Retain the full install contracts, actual Vue declaration candidates and parser
bytes. Compare all six published config-package members against a complete
authentic MIT-licensed packet copied from that frozen installation. The packet
and integrity provenance are test/custody data; they never overwrite providers.
This also refuses a same-version forged config package.

Resolve the unchanged `packages/core/tsconfig.app.json` with the fixture-owned
TypeScript parser, refusing a nearer shadow before executing it. Require no
configuration diagnostics and the genuine inherited `strict: true`. This is a
preparation oracle. It grants no native TypeScript 7 loaded-provider or diagnostic
authority: the existing same-client seven-field positive/negative/repair replay,
full App row, source checks, protected merge and release remain separate gates.

## Evidence and remaining qualification

Local genuine frozen preparation resolves the original core config using the
three pinned providers, without any tracked-byte changes. Receipts include the
original contracts and physical scopes; four tooling laws cover real config
inheritance, missing-provider fallback refusal, wrong versions/forged config,
nearer TypeScript shadows, rejected runtime/CLI identities and lock restoration.
Those unit laws use complete published config bytes and actual runner TS/Vue
packages; their synthetic Gitlink and install callback are explicitly guard-test
inputs and do not claim a real install or native diagnostic verdict.

The prior composed Actions run `38143781718` remains red. Genuine Nuxt preparation
now succeeds, but the original full App snapshots and VueFes historical unprepared
81-file/47-error assertions still fail. VueFes reports 71 Vue files plus 28 TS
files, including nine generated typed-router members and nine additional authored
dependencies, with 21 errors. Those packets and original expectations remain
unchanged. Fresh exact-head Actions and configured native controls are required;
#6879 remains open and no merge/publication acceptance transfers from preparation.
