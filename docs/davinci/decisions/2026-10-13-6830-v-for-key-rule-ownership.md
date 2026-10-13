# Iteration key rule ownership

[Tracking issue #6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The pinned v0.448.0 real-project matrix exposed 40 extra
`vue/require-v-for-key` diagnostics and 25 missing `vue/valid-v-for`
diagnostics across seven projects. Twenty-six extra findings come from custom
components or component-only transparent templates. The remaining fourteen are
in a file whose original `eslint-disable` comment requires separate suppression
handling; valid unkeyed native elements must continue to be reported.

The [pinned upstream rule](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/rules/valid-v-for.js)
assigns missing custom-component keys to `valid-v-for`.
`require-v-for-key` keeps ownership of native repeated elements. Custom tags,
including lowercase registered components and native tags with `is` bindings,
are checked by `valid-v-for`. An unkeyed template forwards that validation to
its children. A nested loop consuming the parent's iteration variable is
checked by its own loop, while independent child loops retain both checks.
Iteration references use parsed identifier references, so string literals and
static property names cannot silently satisfy the key requirement.

The existing #8281 slot/static/object-key exemptions and historical any-keyed-
child policy remain unchanged. Its original fixtures and captured API packets
are retained. JSX mapped components still require keys. The new focused corpus
covers native positives, custom component negatives, nested loops, SVG,
literals, dynamic components, and CRLF/Unicode opening-tag ranges.

The comparison map and zero false-positive/false-negative budgets are unchanged.
Actions source checks, protected queue qualification, actual merge, and the next
published consumer replay remain required; this source change alone proves
neither release readiness nor full matrix completion.
