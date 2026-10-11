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

The source correction has local formatting and diff checks. Hosted qualification
is pending. The n8n job compiles Canon's actual library test module, then executes
compiler-options, construction, typed-router, native-context and package-stamp
controls before the unchanged original authored lifecycle. The regression keeps
missing bare config packages cold, qualifies only the installed actual chain,
invalidates later parent changes, and compares complete configuration fields with
the original factory.

The existing #8520 draft also requires its 85 Clippy failures to be repaired and
its full source/allocation/instruction controls to pass. Callback boxing in that
separate cleanup adds an allocation and needs the original composed workload
qualification. Its original registration-failure refusal remains intact. The
unmerged n8n compiler prefix must be incorporated before deciding whether the
later inferred-dependency failures are independent defects.

#3952, #8142 and #8520 remain unfinished until their exact-head gates, actual merge
and fresh released-consumer acceptance succeed. The 10x target is separate from
any measurement in this record.
