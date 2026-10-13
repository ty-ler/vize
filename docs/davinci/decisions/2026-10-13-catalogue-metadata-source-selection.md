# Exact catalogue subgroup metadata source selection

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The current PR planner treats `docs/scripts/rules/catalogue-subgroups.ts` as
an unknown source and selects Rust, JS packages, tooling and playground. The
file is literal Docs metadata: titles, introductions and existing rule IDs.
Its reverse import closure contains Docs generators and tooling tests, with no
Rust, product package, native binding or playground consumer.

Select tooling only for this exact path in the PR tier. Keep the existing
More-guides ledger exception, all nearby unknown scripts/contracts and mixed
product selectors conservative. The protected merge tier still selects every
source suite and every tooling test. This changes PR input classification,
not the gate inventory or protected qualification.

The consumer review is pinned to genuine parent
`d7fb6be58fd357a2d200441459d7746056cd5dab`:

- `catalogue-render.ts` emits English/Japanese subgroup pages through the
  existing rule generator; that generator reads Rust metadata, while Rust
  does not read subgroup TypeScript. Standalone reference and project examples
  consumed by Rust documentation tests are separate inputs.
- `materialize-content.ts` feeds the Docs build and OG-image source inventory.
  `navigation-render-routes.ts` and `rule-render-assertions.ts` feed the existing
  Docs browser verifier. Its native inline references are Ox Content headings,
  not the native compiler binding.
- The existing generator regression explicitly runs without a previously
  built native binary. Common `check-js` still typechecks `docs/tsconfig.json`,
  including `scripts/**/*.ts`; the package test lane is not a Docs consumer.
- Actual tooling selection at this parent selected 1,046 of 1,206 PR tests,
  retaining all seven transitive subgroup test consumers. The existing source
  CLI producer remains selected whenever tooling is selected. No narrower
  tooling test selection or runtime installation change is part of this slice.

A durable regression verifies the literal local import boundary, actual Docs
render consumers, complete selection of every transitive tooling test, and
absence of subgroup references in tracked Rust and package runtime inputs.
Exact-path, neighboring-path, mixed-product and unconditional merge-group
controls cover both source planners. If future consumers or imports invalidate
the boundary, restore conservative selection or review the new dependency.

The previous direct-Node layer at this exact parent passed its source planner
[job 115127946895](https://github.com/ubugeeei-prod/vize/actions/runs/38345924229/job/115127946895)
in 39s (04:22:55–04:23:34 UTC), including 2s Node setup versus the parent
182s / 144s setup. A separate configured-format failure requires that layer
to be repaired before protected delivery; planner success is a bounded result.

Fresh exact-head Actions, native Stack membership and protected delivery remain
required; this record makes no completed-speed or whole-CI qualification claim.

## Required source-cohort review after the actual guard failure

The [tooling failure at 99a80b](https://github.com/ubugeeei-prod/vize/actions/runs/38347365011/job/115133180375)
correctly refused the changed physical release-test import cohort. Independently
review all three excluded roots and their complete 17 / 19 / 11-file closures:
the union remains exactly 36 physical files. Only `plan-source-checks.ts` changes
from parent `21d1ecb5c96cdc1088cf01ead2c002899b73430f`; all other 35 body hashes,
imports, commands and path membership are identical. The roots reach this file
through `plan-tooling-tests.mjs`, which imports only unchanged `changedPaths`.
The changed body is the reviewed exact Docs predicate and its comments.

Append one atomic named successor review at source
`51394751a791b1f66f177712f79456172d4e3829`, with the complete 36-file hash map.
After the protected parent prefix merged, native restacking retargeted this PR
to main. The old `99a80b` and fresh `513947` both have tree
`883019382ff119f29af5c9e02e82b42dcb1ad423`; all 36 physical body hashes were
independently checked against the fresh remote before reusing the review.
Fresh Actions must qualify the successor head regardless of identical bytes.
Preserve all eight historical reviews, all three excluded roots, positive
trigger paths and every refusal law. Consumer scans across tools, Actions,
Rust, Davinci, npm, root scripts and workflows pass; injected native commands,
unresolved/nonliteral/native imports, partial/linked sources and workflow
injections still refuse. This is a complete body/import review, not a generic
hash refresh or permission to bypass native consumers.

The same job separately exhausted Cargo network transfer while fetching
Wasmtime feature dependencies. Keep that real dependency gate unchanged;
fresh source qualification or a bounded same-head infrastructure retry must
resolve it independently. The guard successor grants no protected delivery
or publication credit before its original Actions complete.
