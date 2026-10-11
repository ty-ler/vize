# Required native semantic completion and terminal ownership

For #6879 and #3984, qualify the parser-to-configured-session completion and
native process teardown on the source-built CLI in the existing native-phase
Actions job. This supplements the original 400-case paired gate, full Stack
qualification and App snapshots. It changes none of their inputs or verdicts.

The frozen input is original record 271, `leaf-parity-escaped-import-keyword`,
base `d55b8238`, retained in the composed `15e51ec040` artifact. The complete
fixture is in `tests/_fixtures/differential/typechecker/native-semantic-completion`.
The corpus manifest binds repair `7a782477742608f5fa98646448c53321974f6d44`
and original source `d55b8238f89bab4418a1a961bd8db1c84911cb42` separately;
the original complete provenance records the composed artifact head and both
CLI/native binary hashes without replacing them with the current producer.
Its manifest authenticates eight physical input files: four Vue files,
`shared.ts`, `tsconfig.json`, and both original `leaf-types` package members.
The original public packet reports five program files. Preserve every original
input byte and the original command, stdout and failing stderr in the fixture.

The unchanged expected public stdout is the entire original packet: TS1260 at
`Comp0.vue` 1:59, TS2304 at `shared.ts` 1:21, all five file rows, complete
program/config/options membership and both aggregate errors. Required parser
completion retains public exit 1 and produces empty stderr after the repair.
The absent `LeafGlobal` is an intentional negative; do not import the leaf
package to make that diagnostic disappear. A normal TS2322 case and its actual
repaired source require complete wrong and clean public packets separately.

The private batch law uses the normal factory and the exact same config. Its
test-only writer retains every generated and physical file, source maps, the
whole raw diagnostic response, selected config bytes, full normalized options
and roots, and `getSourceFileNames` request/response from the diagnosing LSP's
retained API attachment. The process observer belongs to this same LSP owner.
After explicit close, require exactly one completed receipt, full raw stderr,
actual exit 0, reap, no timeout or kill, no reader/process errors and the whole
expected EOF line. This attachment observation does not replace the diagnosing
process with a separate native API invocation.

Three executable controls keep the real native executable and original input.
Unexpected UTF-8 and non-UTF-8 stderr prefixes must replay the entire prefix and
EOF byte vector and preserve the whole original stdout. These wrappers `exec`
native, so the observed PID becomes native's PID. The exit-17 control owns a
separate shell process: retain both wrapper and actual native child PIDs and
statuses, require actual native exit 0 and wrapper exit 17, and refuse a clean
public result with empty stdout and exit 1. Keep the complete public stderr;
the wrapper's status is never claimed as native's status.

`tools/benchmarks/scripts/typechecker-native-semantic-completion.sh` requires
the exact `SOURCE_SHA`, actual native path and required-native environment,
unsets disabling and unrelated capture flags, and reuses the existing locked
`ci-opt` profile, features and target. It archives all test and child packets
under `$RUNNER_TEMP/native-semantic-completion`, including on failure through
the existing job's always-upload path. It adds no standalone Vize builder.

Source preparation, custody and format checks are not native acceptance.
Exact composed-head Actions compilation, all new real-native laws and the
unchanged full delivery gates remain required. No performance improvement,
API-only lifecycle coverage, fix-history closure or release claim follows
from this supplemental gate. The parent delivery change owns the paired issue
comment and workflow wiring.
