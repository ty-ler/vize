# Apply native startup preferences before a shared API snapshot

This is a scoped successor to the
[same-owner editor/API decision](./2026-10-11-8371-same-owner-editor-api.md)
for [#8371](https://github.com/ubugeeei-prod/vize/issues/8371).
The original create-vue structured inlay packets returned `null` on
[the complete source qualification](https://github.com/ubugeeei-prod/vize/actions/runs/38099297202).
Passive capture places that null result in the native editor reply before
decoding or authored mapping; the unchanged stock native request produces
the expected hints. These observations do not expose the backend's internal
preference state or prove the ordering of its inner operations.

The pinned native 7.0.2 source retains initialization preferences as pending
configuration. Its API snapshot update consumes the pending configuration
without installing it, whereas a language-service snapshot installs it.
The source candidate therefore adds two explicit startup operations to the
same-owner shared transport: the existing native `parseConfigFile` reads the
requested configuration, then the supported `custom/projectInfo` requests a
configuration snapshot for one existing absolute member returned by that
read. Its complete configured-project identity must equal the requested
configuration before the first API snapshot opens. This is product startup
work, with its cost inside the original native and real-project budgets.

No file is invented or opened to trigger this barrier. It does not request
inlay hints, hover, diagnostics, or a workspace diagnostic scan, and does not
resend or alter initialization preferences. The existing numeric preparation
trace records the native config result, selected member, attachment and
complete project-info result. Those records attest the actual operation and
response; the SDK still does not expose a native PID in that trace.

Memberless, unsupported or mismatched configurations retire the attempted
shared owner and retain the existing independent immediate API fallback.
The ordinary explicit editor factory, standard backend, fake API and Windows
paths retain their previous startup operations. API functionality remains
available before any editor request. Original constructor/API/editor,
independent-owner and stopped-owner laws remain intact; an additive real
memberless constructor law checks API availability and physical retirement.

The process observer also enumerates children of every owning Linux task,
deduplicating physical PIDs. It retains the original one-child limit, exact
executable, cwd, argv, parent identity, birth and retirement checks. The
previous main-task-only observation missed native children launched from
another test thread; it did not prove that the process had no native child.

The parity workflow's strict whole-environment assertion has an explicit
passive-trace successor: its four original source/executable/build fields stay
exact and the already-approved `VIZE_TRACE_EDITOR_PREPARATION=1` is included.
The failing original source assertion and hosted log remain historical. No
workflow, command, test argument or runtime expectation changes in this fix.

All original inlay requests, parameters, authored inputs, whole expected
packets, preferences and deadlines remain unchanged. The existing native
constructor command picks up the additive fallback control. Fresh Actions
must establish the original hints, original Vben four-process limit, original
eight bare-script cases, native configuration 33/17 custody and all full
source gates. Source inspection and static peers alone do not establish
runtime recovery, merge, release or installed support.
