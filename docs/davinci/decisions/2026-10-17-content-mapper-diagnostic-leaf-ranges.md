# Diagnostic ownership survives navigation normalization

Issue: [#6258](https://github.com/ubugeeei-prod/vize/issues/6258).

The retained standard-backend run
[38992292411](https://github.com/ubugeeei-prod/vize/actions/runs/38992292411)
contains four complete editor sessions. In each session, states 9 (`ignore`)
and 10 (`skip`) leak a TS2322 at the closing quote of `id="bad"`. These are
eight concrete failures inside the twelve known fallback reports described in
[the static owner decision](2026-10-17-content-mapper-static-owner-packets.md).

The generated per-prop initializer maps the complete generated string literal
to the authored value. Navigation normalizes that projection to the unquoted
interior. Diagnostic directives previously used the normalized navigation spans,
so their half-open intervals did not own the terminal quote. TypeScript diagnoses
that generated position and projects it to a zero-length authored range at the
end of `bad`.

Ignore and skip now use the existing diagnostic mapping leaves before navigation
normalization. A mapping with subspans contributes only those subspans, never its
enclosing statement. Disjoint leaves remain disjoint; no parent bounding interval
can absorb an intervening child. The canonical authored directive walk still
decides target ownership, precedence and skip subtrees. No parser, generated-code
reordering, navigation span, semantic link or TypeScript protocol changes.

Expect continues to use its existing single-interval path. This change does not
solve arbitrary disjoint expectations or their usage aggregation.

The source controls preserve the complete directive tuple envelope for normal,
empty and Unicode literals, LF/CRLF, subtree boundaries and orphan expectations.
The real transform control requires the complete generated terminal quote to be
suppressed while its navigation mapping stays interior-only; ignore leaves the
child diagnostic visible and skip owns it.

The existing focused Actions driver compares genuine base
`8df6e1fe3e8e91fe2a0adbb4633d1de38e81e506` and candidate producers using the
unchanged pinned TypeScript backend. It retains all 44 editor reports, all 16
expectation CLI cases, four complete no-directive calibrations, 16 whole
expectation mapper transforms, existing stock LSP selectors and the expanded
Canon controls. Both historical and candidate editor expectations are explicit:
only the exact closing-quote error may disappear in each of the eight repaired
reports. The expectation transforms and no-directive calibrations must remain
identical, including all mappings, generated text, semantic links and diagnostics.

The two inference-only props calls still have no diagnostic source mapping.
Their TS100036 aggregate remains required in all twelve fallback reports. After
successful qualification the ledger should distinguish four unchanged fallback
reports and eight partially repaired reports, with all twelve aggregate frontiers
still open. This is a bounded repair, not completion of #6258 or public release
acceptance. At authoring time the new Rust and backend controls have not run.
