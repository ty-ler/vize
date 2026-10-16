# Elk StatusMedia SSR CSS variable comparison

`StatusMedia.vue.txt` is the complete unmodified
[Elk source](https://github.com/elk-zone/elk/blob/8aa2b4650760eeba4ea1fdd9dc18d8a88ca5d7f0/app/components/status/StatusMedia.vue)
from the existing pinned application fixture. Its byte identity, official
compiler version and implementation digest are recorded in `source.json`.
The upstream MIT license is retained as `LICENSE`.

`StatusMedia.ssr.original.ts.txt` retains the full official output from the
current inspector before its missing `ssrCssVars` input is repaired. The DOM
reference is unchanged. The SSR reference was independently generated through
the pinned public compiler-sfc `parse`, `compileScript`, and `compileTemplate`
APIs, with `ssrCssVars: descriptor.cssVars` and the same filename, production,
scope and binding metadata options as the inspector.

`tests/tooling/inspector-ssr-css-vars.test.ts` executes the actual JavaScript
embedded in the Rust inspector, using a real Node process and the pinned Vue
compiler. It compares the complete DOM and SSR code, requires no compiler
warnings, and checks that the actual server renderer consumes the CSS variable
sentinel. A negative control replaces only the one authored
`v-bind(gridColumnNumber)` with literal `2`; no CSS variable may be emitted.

## Historical check

The public [v0.426.3 CLI](https://github.com/ubugeeei-prod/vize/releases/tag/v0.426.3)
at source `0c36541bde455913ad021d3d2f3bf0e7a0fcef08` reproduces the retained
Elk SSR budget of 9201 additions and 25188 removals on this same 259-file source
and Vue provider. Its Mac ARM64 archive SHA-256 is
`de013b84db921181df3ddd6e3bb5da04637b7cc677fed271053c94e0699eab95`;
the executable SHA-256 is
`4fb15d98311cd20d24082914a30e08101421e0262c40bdd79bc8b6ce8e82c26d`.
This release follows #6519 by 51 commits; it is not that PR's exact head.

Current native output is already different on main because of subsequent
props-rest, page-metadata, nested-await and SSR CSS variable correctness fixes.
Fixing this oracle changes only StatusMedia's official output in the complete
current Elk SSR report: additions remain 9217 and removals become 25010, with
three official errors and no native errors. The addition budget still fails.
No budget, authored consumer, native compiler output, or snapshot assertion is
relaxed by this fixture.
