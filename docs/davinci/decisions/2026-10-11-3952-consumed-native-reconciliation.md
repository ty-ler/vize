# Native editor graph reconciliation

This decision belongs to [#3952](https://github.com/ubugeeei-prod/vize/issues/3952)
and its bounded source repair in
[#8520](https://github.com/ubugeeei-prod/vize/pull/8520). It extends the native
dependency graph work recorded in the
[foundation](./2026-09-27-level-restructure.md), without replacing the original
runtime acceptance criteria.

Native editor graph reuse must retain the exact facts consumed by the original
configuration, source, package callback, shadow generation, and final import
rewrite operations. A successful earlier read cannot stand in for a later
operation. Unknown or failed authority keeps the original cold path. Legacy
and non-editor callers retain their existing behavior.

An exclusive takeover regenerates every retained Vue file through the original
code generation path with the full authoritative overlay scope. It reconciles
source and dependency edges, resets the query surface, and retires package
contributions only after their actual owners have been removed. A still-open
authoritative unsaved buffer remains valid input; a stale closed or deleted
mirror must not resurrect a file.

Reuse also requires complete current package outputs and source ownership
reachable from the actual protected and declaration roots through existing
edges and bindings. Shared ownership transfer, newly reachable overlays,
imported props, and an orphan dependency cycle are explicit correctness
controls. The checks use operation-local evidence and existing graph owners;
they introduce no persistent cache, resolver epoch, parser pass, or request.

This changes the earlier blanket cold policy only where the same complete
inputs produce the original cold source, generated text, maps, package
catalog, and query results, and current ownership and settings qualify.
Unknown facts, read errors, changed configuration, retargeted paths, or
ambiguous ownership still require the cold path. The original cold-policy
inputs and assertions remain retained as historical evidence.

For a proven deleted source, an actual preflight canonical-file result may
replace its old probe only when an independent new resolver operation produced
the exact same-owner, same-input negative file result. The new-operation prefix
is fixed before inserting validation carriers or old facts, and final canonical
validation still rejects reappearance, retargeting, or unknown authority.

The original source failure, DELETE readiness failure, strict native projection
failure, and RSS failure at the earlier source revision remain unresolved
historical observations. Source controls do not prove delivery or performance.
The current source must pass the original Linux provider, native whole-output,
400-case workload, and ordinary protected checks with their original deadlines,
diagnostics, recipes, process constraints, and RSS budgets. Measured results
remain separate from the 10x target and from any claim about their cause.
