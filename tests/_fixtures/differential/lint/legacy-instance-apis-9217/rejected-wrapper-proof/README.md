# Rejected receiver proof counterexamples

PR #9276 was closed without merge. The candidate and these counterexamples are
preserved on `fix/patina-authored-event-wrappers-9217`; no warning suppression
was accepted. Draft #9251 and all 70 original controls retain their ownership.

`global-assign-alias.ts.txt` replaces `Object.assign` through the global object.
`inherited-setter.ts.txt` changes the inherited setter used by native
`Object.assign`. Both copy an actual Vue `$on` method instead of the candidate's
authored callable, so the final call must retain a warning.

`observations.json` records SHA256 and exact baseline/candidate property spans.
The candidate emits no diagnostic in either case. The baseline emits one,
verified by compiling each actual rule against the same cached OXC dependencies
with installed Rust 1.99.0 and a diagnostic-only driver. That focused replay is
separate from complete SFC qualification.

The candidate's `authored_event_wrappers` native integration target includes
both cases as intentionally failing acceptance boundaries. Run:

```sh
cargo test -p vize_patina --test authored_event_wrappers
```

The two boundary tests must pass before reviving the candidate. Positive local
reference controls alone do not authorize suppression. A future effect owner
must authenticate the copy operation, intrinsic identity, prototype/setter
effects and resulting own-property identity. Do not substitute a reflection
name denylist for that authority. Lookup complexity must also remain linear
or indexed rather than scanning every span for every call.
