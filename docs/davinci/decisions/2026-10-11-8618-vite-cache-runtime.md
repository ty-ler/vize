# Keep configured-cache Vue resolution within its source budget

Tracking: [#8618](https://github.com/ubugeeei-prod/vize/pull/8618),
[#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

## Decision

Keep Hebilicious’s configured `cacheDir` fix and its original regression intact.
Move the existing `isOptimizedVueDependency` predicate, including its explanation,
into `resolve-optimized-vue.ts`. Keep its public export through `resolve.ts` and
both original call sites. The predicate body and matching behavior are unchanged.
This is a module extraction; it does not change compiler output or replace a
legacy product implementation.

The contributor’s signed commit remains the direct ancestor of the move-only
commit. Its author, message, four original source blobs and parent are retained.
The configuration hook, state field and original test file stay byte-exact.
Reversing only the move and its import/export reconstructs the authored resolver
byte-for-byte. The verified public contributor is credited on the move commit.

## Validation

The approved original Check run `38135113909`, tooling shard 3 job
`114465331168`, failed the existing source-length test: `resolve.ts` grew from
1,271 to 1,290 lines. Its 1,214 tests recorded 1,204 passes, one failure and nine
existing skips. The extraction returns the resolver to 1,271 lines and adds a
24-line module. The unchanged source-length command passes against the same
`31323aaa027b48540b4cf5f80b68155b704a30fc` base, with no limit change.

Formatting, lint with warnings denied, and whitespace checks pass for the moved
source. The authored resolver regression remains mandatory in the existing
package test command. Byte preservation proves this extraction keeps its source
logic; it does not stand in for fresh Actions execution or consumer acceptance.

## Remaining delivery

Keep the contributor’s Draft state and branch intact until the concrete change
is reviewed and its exact remote head is checked. Qualify the published corrected
head through existing Actions, protected integration and a release. Any paired
issue update stays concise. The original source failure and pending remote
outcomes remain separate from the local size-gate pass.
