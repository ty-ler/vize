# Preserve external Markdown destinations

Issue: [#6101](https://github.com/ubugeeei-prod/vize/issues/6101).
The Japanese reading audit in
[#8372](https://github.com/ubugeeei-prod/vize/issues/8372) exposed this renderer
failure independently of the editorial work.

## Decision

Use Ox Content 2.88.0, the first compatible 2.x release containing its native
[external Markdown URL guard](https://github.com/ubugeeei-prod/ox-content/pull/603).
The documentation previously pinned 2.81.0. In the deployed Japanese testing
guide, its converter treated the original absolute `SUPPORT.md` URL as a
relative Markdown page and produced a local `https://github.com/…/SUPPORT/index.html`
route, which returned 404. The destination also lost its external-link attributes.

Keep every authored Markdown destination unchanged. The native renderer owns
the distinction between URLs with URI schemes, protocol-relative URLs, and local
Markdown routes. Reuse its maintained Rust fix instead of rewriting source URLs
or reversing corrupted output. The lockfile update includes the renderer's
required TypeScript 7 dependency closure; unrelated package records and snapshots
retain their original bytes.

## Evidence and delivery

The regression reads the actual testing guides in all five locales and renders
them with native SSG link conversion enabled. Their original Support destination,
new-tab target, and opener protection must survive. Additional Markdown and raw
HTML cases retain external schemes, internal routes, query strings, and fragments.
Both new regressions fail with the previous native renderer and pass with 2.88.0.

The unchanged Japanese emphasis, translation, and materialized-content laws also
pass. The full hosted Docs campaign retains every original route and assertion,
and adds all five testing routes on desktop and mobile. Those browser checks
assert the exact original external Support URL and attributes before validating
the remaining links, layout, fonts, and captures.

Merge, hosted browser success, and deployed original-link replay remain delivery
requirements. The Japanese JSX anchor and the separate Chinese authored emphasis
finding remain outside this fix; the full Japanese editorial issue stays open.
