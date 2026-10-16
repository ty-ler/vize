# Supply authored CSS variables to the official SSR inspector

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The CLI inspector's official Vue `compileTemplate` call requested SSR without
passing the SFC descriptor's CSS variables. Vue warned about that omission and
compiled Elk's `StatusMedia.vue` without its server-rendered grid variable.
Vize already emitted that variable, so the comparison included a difference
caused by the incomplete reference invocation.

Pass `ssrCssVars: descriptor.cssVars` to the existing official compiler call.
The native compiler and all comparison budgets are unchanged. The existing
749-line inspector does not grow; the change adds one option and removes one
adjacent blank line.

The complete upstream StatusMedia source, pre-fix official SSR output,
independent complete DOM/SSR references, provider identity and license are
retained under `tests/_fixtures/differential/compiler/inspector-ssr-css-vars/`.
The focused test executes the inspector's actual embedded script in Node.
It failed with Vue's missing-CSS-variable warning before the change, then
passed all three cases: source/provider identity, complete DOM/SSR output, and
a literal-CSS negative control. The CSS sentinel `:--v4a184587` is intentional;
the official server renderer converts it to `--v4a184587:2;` for value 2.

## Scope and remaining parity failure

A public v0.426.3 CLI replay regenerated the old 9201/25188 passing SSR counts
on the same 259-file Elk archive and official provider. Current main and the
repair branch both produce 9217/25007 before this change, with identical native
outputs. The intervening differences include shipped props-rest, page-metadata,
nested-await and CSS-variable fixes; this change does not revert them.

Replaying the immutable current CLI with the repaired source's embedded
official script gives 9217 additions and 25010 removals. Exactly one file's
official output changes: StatusMedia, from 20/25 to 20/28. All 259 native
code/error/warning packets remain identical; official errors remain three and
native errors remain zero. The existing addition budget of 9201 still fails.
This local adapter replay is not a source-built CLI acceptance claim; Actions
must validate the rebuilt CLI and unchanged application gates.
