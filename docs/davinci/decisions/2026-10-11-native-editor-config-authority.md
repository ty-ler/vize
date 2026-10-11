# Native editor configuration authority

Tracked by [#8142](https://github.com/ubugeeei-prod/vize/issues/8142) and
[#3952](https://github.com/ubugeeei-prod/vize/issues/3952); the original authored
campaign remains in draft [#8520](https://github.com/ubugeeei-prod/vize/pull/8520).

An ordinary Vue configuration does not require the optional typed-page router
plugin. Its actual absence must produce `None` without making the consumed
configuration unknown. An enabled plugin still requires its original supported
root and configuration-chain facts. Missing, malformed or unsupported inputs
remain a refusal.

## Source defect and correction

`typed_router::configured_root_consumed` previously ended with
`facts.qualified &= value.is_some()`. That conflated a known absent plugin with
an unsupported root or loader error. `refresh_vue_compiler_options_consumed`
combines this packet with the actual selected chain, so an otherwise complete
ordinary project becomes unqualified before graph construction.

The correction distinguishes these outcomes during the same configuration
operation. It preserves the original optional root value and every generated
output. It does not add a fallback, a parser, a pipeline stage or another index.

| Actual configuration outcome | Root value | Configuration authority |
| --- | --- | --- |
| Missing `plugins` field in a loaded options map | `None` | Known |
| Empty plugin array or supported foreign plugin entries | `None` | Known |
| Unsupported plugin field or entry shape | `None` | Unknown |
| Selected typed-router plugin with malformed `rootDir` | `None` | Unknown |
| Selected plugin whose default-root loader cannot complete | `None` | Unknown |
| Selected plugin with an actual supported root and complete chain | Original root | Known |
| Options map unavailable | `None` | Unknown |

Unknown chain, source, owner and registration packets remain monotonic refusals.
Retired-owner filtering cannot repair a configuration packet that was already
unknown. No diagnostic timeout, lifecycle expectation or resource budget changes.

## Original campaign evidence

The pinned licensed n8n source is
`e882e8a483f433facb47bab9b407d0ec00a81172`. Upstream remains read-only. The
original registry, three authored components and requested lifecycle are retained.

| Source and control | Terminal evidence |
| --- | --- |
| Original `b27e356647514d7fe3cc3d7f26f5643b31ae3ea3` | [Run 38104231472](https://github.com/ubugeeei-prod/vize/actions/runs/38104231472): deleted RunData dependency diagnostic timed out; producer was killed during shutdown. |
| Numeric first-loss trace `6ec6d0c0d29b2e8bed59e397b592517b2e8c1961` | [Run 38106505497](https://github.com/ubugeeei-prod/vize/actions/runs/38106505497): configuration reason 40 precedes aggregate reason 21 in all fourteen cold graph constructions. No first-loss walker or retired-owner failure. |
| Authentic installed control `329864a0fb` | [Run 38107871386](https://github.com/ubugeeei-prod/vize/actions/runs/38107871386): original CLI, slot, fixture and compiler checks pass; authored lifecycle fails in 538688 ms. Configuration reason 40 remains, with no unresolved-extends reason 95/96; actual dependency registration reason 76 follows. RunData version 5 produces an empty diagnostic packet instead of the required deleted-module diagnostic. |

The installed control uses n8n's declared pnpm 12.4.2 and original frozen lockfile.
It records wrapper/native producer hashes, original manifest/config/lock hashes,
and selected config/package-manifest equality against the pinned workspace files.
Installation takes place after the fixed original CLI and slot corpus checks,
immediately before the original authored lifecycle. The fixed CLI corpus correctly
refuses an installed `node_modules/qrcode.vue` entry; its oracle is preserved.

The installed control artifact is
[11691200656](https://github.com/ubugeeei-prod/vize/actions/runs/38107871386/artifacts/11691200656),
with digest
`sha256:bf1a8e8bb6d544d20ca5e0716c1eceefd67a8a940de387f2c90cd8961f3b68bd`.
These are source-build observations, not installed-release acceptance.

## Validation and remaining work

The source correction has local formatting and diff checks. Composed source
`0e5818c8233c49a81974d74a6420b0d5c2dbbc8e` passes the production build, complete
compiler corpus and pinned fixture jobs in
[run 38109170762](https://github.com/ubugeeei-prod/vize/actions/runs/38109170762).
Canon's newly enabled whole-library test compilation exposes eight retained test
access/signature errors; it fails before any control executes. These failures and
the earlier composed production compilation failure in
[run 38109011157](https://github.com/ubugeeei-prod/vize/actions/runs/38109011157)
remain explicit failed receipts. Test access corrections keep the original
assertions and supply the same facts to the unchanged underlying operations.

[Run 38109427658](https://github.com/ubugeeei-prod/vize/actions/runs/38109427658)
compiles all 1994 Canon library tests and passes six compiler-chain controls,
two constructor controls and eight typed-router controls. The remaining new
typed-router control incorrectly expects a missing compiler config to erase the
legacy default root. The original operation preserves that value but refuses
qualification. Its corrected control compares the complete original root value,
requires the cold refusal, and proves later creation invalidates the absence fact.
This failed test receipt remains recorded; later filters have not yet executed.

The hosted job compiles the library once, then collects all seven independent
filter results and fails admission if any fail. A failed early law cannot hide
later configuration/ownership refusals. Canon production Clippy follows in the
same cached job with the original warning and wildcard-import errors enforced;
this scoped evidence does not replace the eventual full-workspace gate.

[Run 38109645576](https://github.com/ubugeeei-prod/vize/actions/runs/38109645576)
executes all seven filters: compiler-chain 6/6, construction 2/2, typed-router
9/9, package-index 10/10 and stamp 35/35 pass. Dependency-consumption passes
6/7 and native-context passes 95/104. The new bare-package control compares a
lazy alias lookup after installation; its correction takes the actual original
alias snapshot before installation and retains the whole-value comparisons.
The other nine existing laws expose real initial-key, scoped-negative, shadow,
materialization, rename, retained-buffer and repeated-occurrence failures.
Their original assertions remain. Clippy was skipped after the failed law step;
its independent source check will still run after failed tests, and every failed
law continues to block lifecycle admission.

[Run 38109914318](https://github.com/ubugeeei-prod/vize/actions/runs/38109914318)
passes the corrected actual-chain and original-key laws: filters are 6/6, 2/2,
9/9, 10/10, 7/7, 96/104 and 35/35. Canon Clippy actually runs and leaves only
two stale impl-level lint expectations after the argument packet extraction.
The remaining original shadow control supplied `missing.json`, but the real
setter replaces the supplied scope with its actually resolved `package.json`.
Its authentic negative now deletes that selected manifest after registration,
then restores the same manifest before the positive original shadow operation.
The raw-negative control used a configured absent `.vue` target, which the
original resolver deliberately preserves as positive native topology. Its
negative uses an actually unmapped private specifier; the configured missing
Vue target remains explicitly covered as positive. All original refusal,
membership and empty-reachability assertions remain. Six other context laws
still require source fixes; no diagnostic or instruction budget is changed.

[Run 38110261974](https://github.com/ubugeeei-prod/vize/actions/runs/38110261974)
at `ed5b396cba` compiles all 1995 library tests, passes production Canon Clippy,
and passes the authentic shadow and private-negative/positive laws. Filters are
6/6, 2/2, 9/9, 10/10, 7/7, 99/105 and 35/35. The six unchanged context failures
are workspace imported-prop invalidation, rename admission, deleted live-buffer
whole-output mismatch, doubled package regeneration and two missing canonical
shadow materializations. Temporary test-only failure diagnostics retain actual
returned stamp kinds/owners and canonical source indexes to identify those
causes. They compile out of production and do not qualify any missing facts.

Hosted qualification is pending. The n8n job compiles Canon's actual library test
module, then executes compiler-options, construction, typed-router, package-index,
dependency-consumption, native-context and package-stamp controls before the
unchanged original authored lifecycle. The regression keeps
missing bare config packages cold, qualifies only the installed actual chain,
invalidates later parent changes, and compares complete configuration fields with
the original factory.

The temporary aggregate and unresolved-extends numeric trace exports are removed
after their exact failed packets establish the first loss. Every underlying
qualification, observed stamp and cold refusal remains. Retained dependency fact
tests move unchanged into their own module to satisfy the existing 350-line gate.

The existing #8520 draft also requires its 85 Clippy failures to be repaired and
its full source/allocation/instruction controls to pass. Callback boxing in that
separate cleanup adds an allocation and needs the original composed workload
qualification. Its original registration-failure refusal remains intact. The
unmerged n8n compiler prefix must be incorporated before deciding whether the
later inferred-dependency failures are independent defects.

#3952, #8142 and #8520 remain unfinished until their exact-head gates, actual merge
and fresh released-consumer acceptance succeed. The 10x target is separate from
any measurement in this record.
