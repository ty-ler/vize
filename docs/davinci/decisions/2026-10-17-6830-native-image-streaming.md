# Bound native image authentication memory

Issue: #6830. Full qualification [38993084178](https://github.com/ubugeeei-prod/vize/actions/runs/38993084178)
at `2b0cf6c084ea0d4ab0a3dce33cfb9ebf0e7c8db2` completed the original Misskey
edit-churn workload but failed its unchanged 136 MiB server-RSS assertion:
the peak was 140.94 MiB at the first file-lifecycle cycle. RSS subsequently
fell; this observation alone does not establish an accumulating edit leak.

Each native editor-session authentication previously read the entire
24,101,026-byte executable into a temporary vector solely to hash it. The
same opened file is now read through a 64 KiB stack buffer. SHA-256 consumes
every successful read until EOF; interrupted reads are retried, every other
read error rejects authentication, and a digest is returned only at EOF.
There is no metadata shortcut, path cache, partial hash or changed provider.

The complete initialize-response comparison still runs first, every session
still authenticates the full executable, and the known digests, hexadecimal
encoding, decision placement and shutdown protocol remain unchanged. Opening
the path once retains the existing file-handle semantics. The buffer and
hasher have bounded storage independent of image size; this removes the
whole-image allocation without changing Cargo profiles or allocator settings.

Focused controls compare streaming with one-shot SHA-256 for empty input,
hash-block and buffer boundaries, and multiple buffers; exercise repeated
short reads and interruptions; reject an error after a complete buffer; and
detect corruption beyond the first buffer. Existing complete-initialize and
shutdown transcript controls remain in place.
The four new controls pass in a small local Cargo harness containing the exact
helper and test bodies with `sha2:0.11.1`; full Canon integration remains an
Actions check. Rust formatting and whitespace checks pass.

The earlier same-fixture [38929265536](https://github.com/ubugeeei-prod/vize/actions/runs/38929265536)
at `a00fb6cff9268e1371ba260739d905050e2a2573` passed at 133.37 MiB, but several
product changes separate those sources. Allocator retention of temporary
image bytes is a hypothesis, not a measured attribution. Acceptance still
requires an Actions run of the original incremental and churn tests against
the failed source plus this patch, retaining original metrics, complete
authentication evidence and the unchanged 136 MiB budget. No RSS improvement
or full-qualification result is claimed by this change alone.
