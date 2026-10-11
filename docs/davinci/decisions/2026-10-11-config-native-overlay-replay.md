# Retained unsaved overlays after native configuration invalidation

Issue: #8371; settings transport: #8476.

Disk configuration and declaration events discard the shared native editor
owner without waiting for its protocol response. The attached project API is
retired with that physical process. Current unsaved buffers remain owned by
`CorsaProjectClient`, but previously only an editor request could recreate the
transport. An immediate project API request therefore failed, and unchanged
buffer bytes could be mistaken for content already sent to the new snapshot.

Keep discard spawn-free and nonblocking. The next project API access restores
the shared transport under the existing native operation deadline. Query and
diagnostic selection restores it before testing the fresh API capabilities.
Replay every complete retained buffer through the existing batch snapshot
writer, including its typed materialization fallback. This preserves a single
refresh where supported and the existing one-physical-child ownership boundary.
The retained map survives a partial replay failure, and a failed new attachment
is retired before another API request can observe its incomplete snapshot.

The additive Linux native test keeps the original authored source and leaf
edit fixture. Two buffers have opposite disk and unsaved types. After both a
configuration and declaration invalidation, the first request uses the project
API directly, checks both unsaved types, confirms complete retained buffers and
authored disk bytes, and observes the old process reaped and exactly one new
physical owner. Identical batch writes then keep those answers and that owner.
The existing stopped-owner five-second discard law remains unchanged.

Pinned Rust formatting and source checks are local preparation. Native Linux
execution, source custody, exact-head Actions, protected Stack delivery and
installed release acceptance still require the parent delivery lane.
