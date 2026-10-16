# Verify newly published JSR versions immediately

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

Release v0.457.0 [run 38805261385](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385)
published its primary artifacts but remained failed because the
[Deno consumer](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385/job/116687943513)
rejected the newly published JSR version. At 2026-10-15T21:45:19Z, Deno 2.9.7
reported that version 0.457.0 existed but was newer than its minimum dependency
date, 2026-10-14T21:45:19Z. This was a dependency age rejection, not a missing
publication or propagation delay.

[Deno's supply chain documentation](https://docs.deno.com/runtime/packages/supply_chain/)
states that Deno 2.9 applies a 24-hour minimum age by default and accepts
`--minimum-dependency-age=0` for an individual command. The release consumer
intentionally verifies the version that has just been published, so apply that
flag only to its Deno invocation. A waiting period would prevent this job from
verifying a new release immediately.

The command still imports the exact `jsr:@vizejs/vize@${JSR_VERSION#v}` version.
The source checkout, enabled-channel gate, publication dependencies, fresh
consumer directory, registry imports, and existing consumer assertions remain
unchanged. No repository-wide dependency age policy, Node/Bun command, package
version, publication operation, or existing release receipt is changed.

The existing JSR workflow contracts and YAML parsing validate the local edit.
The next release's Deno consumer must supply the hosted acceptance result;
this policy change alone does not establish that a release passed.

The first repair PR's [JSR package check](https://github.com/ubugeeei-prod/vize/actions/runs/38882495127/job/116912317020)
failed before reaching Deno: its workflow contract test imports `yaml`, but the
job had never installed the declared tooling dependencies. Local validation
used an existing `node_modules` and did not expose that missing prerequisite.
Set up Vite+ and install only the root `vize-workspace` dependency graph from the
frozen lockfile before those tests. Lifecycle scripts remain disabled, and no
product build is added.

Running that job's staged consumer in a fresh directory then reproduced the
same age rejection for `npm:vize@0.457.0`. The generated `jsr.json` already sets
`minimumDependencyAge: 0` for publication, but the separate consumer script
does not load that configuration. Give this Deno invocation the same explicit
flag; its file import still reaches the generated facade's exact npm versions.
Under local Deno 2.9.5, the unchanged staged consumer fails without the flag
and passes with it; the publication dry-run also passes. The hosted workflow
retains Deno 2.9.7 and must confirm the complete job on its clean runner.
