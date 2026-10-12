# Passive Docker lifecycle evidence

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The existing plugin SDK isolation laws have genuine Docker timeouts on Blacksmith
32 CPU runners. Protected Windows-loader candidate `64959025` failed three
original five-second executions in Check `38158767449`; documentation source
`648` failed five- and ten-second executions in Check `38158829920`. The pinned
image had already been pulled. The original planned tooling runner executes
files serially, so local test concurrency is not an established cause.

A separate successful diagnostic attempt of `64959025` retains the original
failures. The same three controls then took 1.330, 0.868 and 1.199 seconds under
their unchanged five-second limits. Healthy Davinci source `bcc` ran whole hook
batches in 1.218 seconds and host isolation in 0.192 seconds. These whole-test
times do not identify Docker create, start, guest execution or cleanup costs.

## Decision

An explicit `ci-docker-phase-diagnostic` PR label opts the existing four source
tooling shards into a passive observation. Ordinary runs start no observer.
Both original mandatory commands, their complete selected tests, environment,
source-built CLI receipt, frozen image, security controls and deadlines remain
unchanged. The existing image pull remains mandatory and runs before observation.
There is no new builder, retry, test serialization or test job.

The observer subscribes to Docker container `create`, `start`, `die`, `oom` and
`destroy` events. Docker itself receives a finite projection template: full actor
attributes, guest arguments, environment, mounts and content are never requested.
Ownership requires the actual sandbox host PID and start ticks, its physical
checkout cwd and the same authenticated `Runner.Worker` ancestry. Unknown and
other-job events are refused without preserving their identities. Complete
container IDs bind later events after a genuine owner process exits.

Allowlisted inspection preserves actual image, daemon, container and resource
identities. Two readers permit at most four pending inspections, each bounded to
0.5 seconds; unavailable and omitted inspections remain explicit. Exact daemon
nanosecond timestamps yield only observed lifecycle intervals. Missing stages,
PID substitution, source changes or producer receipt mismatches remain refusals.
Clean checkout authentication runs before existing native builds. Their single
known generated `npm/native/index.d.ts` retains exact old/new bytes and mode;
every other tracked change and every staged change refuses. The entire source,
declaration and same-run CLI receipt must stay identical during observation.
Setup, inspection and finalization clocks are evidence overhead, not unchanged
workload timing. Shared kernels, Docker configuration and guest processes are
never changed by this observer.

The original formatter corpus upload runs first with its complete unchanged
body. Observation finalization and a separate bounded artifact run afterward,
including on original failure. Setup errors do not suppress the original command;
missing or failed observation remains an explicit diagnostic failure. Fresh
run/attempt/job directories preserve prior evidence. Authored process, source,
projection, timeout, stream and PID-reuse controls precede hosted qualification.
Final unterminated JSON frames refuse without persisting their content. Each
observed container declares missing and repeated phases; partial lifecycle
evidence stays partial even when other observed intervals are available.

Original source `29f8cc03`, Check `38162591888`, actually supplied the opt-in
environment to all four shards. Their clean checkout receipts authenticated
synthetic source `c07aa84a`; setup then refused before daemon observation.
All four unavailable packets remain retained. A bounded PID, parent, start-tick
and executable-basename ancestry packet and finite setup stage now distinguish
ownership refusal from later source or daemon failures without broadening the
required worker ownership. Native run `38162591678` independently failed the
historical custom-directive source guard; its complete failed log is preserved.
Original clean-source laws also exposed Python import cache writes; owned entry
points now prevent bytecode writes, proved by an actual fresh Git checkout.
The existing uploader law retains the original first upload and explicitly
admits only the two gated nonbuilder diagnostic steps; authored builder and
unconditional-observer mutations remain refusals. No source-cleanliness or
retention oracle was exempted.

Source `449d1098`, Check `38178521318`, passed all four original tooling commands;
the four additional diagnostic finalizers alone refused unavailable ownership.
The retained shard-two packet reports `PermissionError` at runner ownership.
Before any ownership read, the same-run source receipt is now authenticated.
The ancestry packet retains PID, parent, start ticks, comm and UID through every
read failure. Only a permission-denied exact `/proc/<pid>/exe` read may fall back
to noninteractive `sudo readlink`, with a one-second deadline, 4 KiB output bound
and exact before/after birth, ancestry and UID equality. Public evidence keeps
only basename, bounded result identity and elapsed time; full executable paths
and errors are excluded. `Runner.Worker` remains the sole accepted owner.
Protected ancestors above an authenticated worker may remain explicit gaps;
an unavailable worker, `Runner.Listener`, malformed stat or changed birth refuses.
Received event frames and privileged query receipts each have a 4096 bound.
Authored permission, partial ancestry, role, timeout, output and birth controls
precede a genuine successor qualification. No kernel or process mutation occurs.

Fresh-main source `5de93232`, Check `38181826501`, passed shard three's
original 1,013 tests with zero failures. Its additional diagnostic refused
at source custody before ownership. The authenticated artifact `11717639006`
retains the whole 1,219-byte ZIP, CRC validation and SHA
`0e395aa948cf1bc8548563f44df52b3d4afdebe7119b5b2646625fdfef9ea320`.
The original raw job log `114596280160` is 674,565 bytes, SHA
`94c5d3cc7ba59aa9d8afe814edf474cedb0c873539bf21b3c62be4d05a6b14ec`.

The observer had compared the producer's transport-envelope digest with the
different differential build receipt. The existing producer hashes
`source-cli.json`; its unchanged consumer restores that envelope to
`target/ci/vize.source-build.json`. Authenticate those actual bytes, source,
tree, run and attempt. Stream and compare every original CLI, differential
receipt and SFC oracle member against its complete declared body, path and
mode, retaining the separate differential receipt unchanged. Before/after
observation must preserve every member. Byte totals and elapsed time record
this read overhead. No provider or producer recipe changes.

A real inert-byte fixture now invokes the existing `packSourceCli` and
`restoreSourceCli`, then the actual Python observer. It failed on the original
digest comparison and passes after the fix. Wrong receipt kind, run attempt,
same-size preserved-time member corruption, permissions and symlinks refuse;
the original whole-source, staged-declaration and no-bytecode controls remain.
This authenticates transport wiring, not a Rust build or live Docker capture.

Source `6453d309`, Check `38183866525`, retained all four successful original
tooling commands. Its first two shards authenticated 14 and 21 containers,
respectively, with all 56 and 84 create/start/die/destroy events complete.
Every refusal, omitted inspection and unowned event counter was zero.
Create-to-start maxima were 93.922 and 110.553 milliseconds. These healthy
observations do not establish the cause of the earlier five-second failures.

The remaining two shards had valid source, owner, daemon and stream custody,
but no eligible events. Their additional finalizers rejected zero observations
after incorrectly describing the empty lifecycle as complete. Preserve both
original diagnostic failures and all four original command outcomes.
The unchanged actual tooling planner and shard selector assign the mandatory
native sandbox law to shard one and the complete sandbox law to shard two.

Bind the actual selected plan bytes and shard through the original tooling
command selector before and after observation. If a selected known mandatory
Docker law has no observations, refuse. Otherwise a valid stream with every
counter zero and no container, phase, inspection or event bytes may record
`no-eligible-container-observations`, with lifecycle coverage `none` and
qualification false. This supplies no lifecycle or causal credit and makes
no claim that unknown future tests cannot invoke Docker. Unavailable streams,
malformed or refused frames, overflow, omitted inspections, partial lifecycle,
changed plans and source/producer changes remain diagnostic failures.
Authored finalizer controls retain all those refusals and the actual original
selection, including complete merge-suite admission.

Failed-only retries retain the immutable original producer receipt and all three
member bodies. A different consumer attempt requires the same shared
`verifySourceCliConsumerUse` adapter used by restoration and the SFC oracle;
bind its physical use-receipt digest and exact producer/consumer attempts before
and after observation. Normal same-attempt observation keeps its original reads.
The real Git/tar/Python law admits authenticated producer two to consumer three,
while absent, forged, foreign, future, linked or altered evidence still refuses.

TODO: qualify the corrected exact-source four-shard receipts and actual merge,
then attribute costs only from complete observed intervals. No causal repair
or CI speed gain is claimed. Whole #6830 targets, release qualification and
other original gates remain unfinished.

Docker's [event filtering](https://docs.docker.com/reference/cli/docker/system/events/)
and [inspection templates](https://docs.docker.com/reference/cli/docker/inspect/)
define the passive read interface; retrospective events are limited to 256, so
the live stream is started before the original tooling commands.
