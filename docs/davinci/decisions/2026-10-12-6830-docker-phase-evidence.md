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

TODO: capture one qualified exact-source four-shard run, retain the original
outcome and source/provider receipts, and attribute create/start/guest/cleanup
costs only when the actual events prove them. No causal repair or CI speed gain
is claimed. Whole #6830 targets, release qualification and other original gates
remain unfinished.

Docker's [event filtering](https://docs.docker.com/reference/cli/docker/system/events/)
and [inspection templates](https://docs.docker.com/reference/cli/docker/inspect/)
define the passive read interface; retrospective events are limited to 256, so
the live stream is started before the original tooling commands.
