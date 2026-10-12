# Authored protocol proxy native termination

Decision: #6879; delivery: #8675. The protected candidate
`9a9dcb137e64f24901a4b28489b13d7cf0556b2b` completed semantic answers but
failed five original rename/signature cases during shutdown. Each retained
whole refusal has reaped Unix status 36096 (exit 141), empty wrapper stderr,
and no timeout or kill. The candidate was removed from the queue immediately.

The authored Perl proxy passed a writable regular file to `IPC::Open3` as
its stderr argument. Open3 replaced that handle with a new pipe reader; the
proxy then closed the reader. Physical descriptor and native wait receipts
prove the original shutdown control terminated with SIGPIPE 13. Duplicating
that regular-file descriptor preserves the whole native stderr. It also
exposes the separate pinned TypeScript-go 7.0.2 Exit cancellation: genuine
standard Shutdown/Exit still returns 1, while acknowledged Shutdown then
native stdin EOF returns 0. Neither nonzero result is accepted.

The fixture now parses complete frames and translates only the actual
params-less client Exit after the complete pinned native binary identity,
whole matching initialize result, matching null Shutdown response and stable
owned process identity. It closes native stdin and retires the client read
pipe immediately, retaining the complete original client Exit trace. This
also permits a parent to await process completion while its writer remains
open. Descriptor zero stays occupied by a read-only `/dev/null` handle while
receipts are written. Observed post-Exit bytes remain explicit refusals.
Unknown binaries retain the original standard frame forwarding and actual
status/stderr. The default SDK and all Canon production bodies stay unchanged
from `deb6a0ba0f8713b9d116538cccd0fc9d5b6a5570`.

Complete framing, identity and refusal controls include fragmented/coalesced
frames, partial tails, duplicate requests, numeric/string request identity,
wrong contracts/ACKs, missing or replaced process births, and an actual foreign
executable with a matching fake contract whose whole stderr and exit 17 remain
unchanged. Original readiness, signature and rename assertions remain intact.
A separate mandatory native EOF receipt verifies actual PID/birth/image,
complete client/server frames, matching ACK and actual waitpid/reap. Passive
CI copies use the exact `pr` or `full` nextest profile's existing recursive
artifact producer. A source law binds both complete producer paths; absent
nextest profile grants no artifact credit, and unknown profiles refuse. No
workflow command or builder is added.

The original400 source guard first refuses the actual 128-file delta because
the seven fixture bodies are outside its closed source scope. A separate
qualifier authenticates all seven complete before/after bodies, including
four genuine absences, before enrolling those exact files. The original
121-source/122-body SDK authority and every runtime/input/lock refusal remain
mandatory. Removing only this fixture qualifier restores the whole original
workflow byte-for-byte. Missing, duplicate, foreign and partial fixture sets
still refuse; neither source admission nor these test-only changes grants
performance credit.

The first actual d6 original400 run retained both sides and `paired.json`,
then refused at final source custody: the final SDK guard had not enrolled
the separately authenticated seven fixture paths. The final boundary now
rechecks all seven actual Git bodies and the complete stored fixture receipt
before enrolling only those paths. An independent finite source pair admits
one complete final-caller successor alongside either complete reviewed
fixture variant. Its complete helper body and metadata are authenticated too.
Both original caller bodies, all 121 SDK sources, 122 whole bodies, 23 preserved
bodies and lock checks remain mandatory. The whole original `requests.ts`,
workflow, inputs and budgets stay unchanged. Removing only the finite caller
edits restores the original complete final body; partial, foreign, changed
or mismatched receipts remain refusals. Source admission supplies no
historical or new original400 runtime acceptance.

The original pending/killed Exit-with-open-writer probe and the intermediate
Perl descriptor warning are retained as failures. Corrected direct Darwin
controls complete actual Exit/EOF, Exit with an open parent writer, and
Shutdown/EOF with status 0, complete readers, no kill/timeout and unchanged raw
native stderr. These probes grant no Rust, Linux, whole-project or performance
credit. Fresh exact-source Actions, all original native/400 gates, the whole
protected suites and actual merge remain required. Original #8614/#8615 and
broader typechecker/real-project acceptance remain unfinished.

Fresh source `d6b3618d2f973ae6da559130955056f5c2d8ea98` passed its native
phase but failed strict Clippy in the added lifecycle test: ten standard
`format!` macros and the Rust 1.99 exact-chunk lint. The bounded correction
uses `cstr!`, preserves the standard error result through explicit conversions,
and retains the odd-length refusal before `as_chunks::<2>()`. Reversing only
these formatting/type substitutions restores the whole original test body.
The original seven-body table remains immutable; a separately authenticated
single-body successor identifies the correction. An isolated Darwin metadata
and Clippy check used existing compiled dependencies without building or
relinking them; it grants no Linux, full Rust or native acceptance.

The same source's original400 run retained both original sides and the paired
packet, then failed final source reauthentication: its final SDK guard had not
enrolled the seven separately authenticated fixture paths. The failed whole
run remains a failure. Final fixture reauthentication and a bounded whole
final-guard successor are required before any original400 qualification or
protected queue admission.

The joint `56b417` source-host run retained 32 passes and one failed original
guard positive. That positive now reads a capsule of the complete `e17c27d`
final body, captured from raw Git. Its exact source, mode, Git blob, byte length
and whole SHA remain mandatory; missing, foreign or changed capsules refuse.
The capsule needs no historical Git object or network fetch in shallow CI.
Every other current source read and original refusal stays unchanged. The seven
successor laws and actual Git final-boundary proof require the new complete body
separately; this source test grants no historical runtime credit.

The actual `dc7b2458` source-plan job rejected the generated Maestro migration
ledger: the Clippy correction's test-only `use vize_l0::cstr` at lifecycle test
line 8 added one real L0 consumer. The authoritative inventory generator adds
that exact test/dev row; all other generated files stay unchanged, and its
19-file check passes. This metadata repair changes no fixture, native body,
workload, source qualifier or budget. The same head's original400 workflow
passes separately; its whole packet is retained. The original source-plan
failure remains a failure, and the metadata successor requires fresh
exact-head source/native/original400 and protected qualification.
