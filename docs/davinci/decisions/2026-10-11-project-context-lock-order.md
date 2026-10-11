# Project configuration watcher lock order

Issue [#8371](https://github.com/ubugeeei-prod/vize/issues/8371) requires native
project ownership to stay responsive during configuration changes.

The cached document route previously retained a DashMap shard guard while
waiting for the context registry mutex. The watcher held that registry mutex
while reading or clearing document routes. A background request and foreground
watcher could therefore wait for one another indefinitely.

Document dispatch now copies the route before locking the registry. The watcher
marks retired cells and installs replacements under the registry mutex, then
releases it before reading and clearing routes. Its routing-change guard still
spans the complete operation. Old process retirement and primary-document
cleanup still happen after route invalidation.

Two tests pause the actual production paths at these lock boundaries using
thread-local hooks and channels. Each holds the opposite lock and probes its
availability before releasing the worker. They detect the old lock retention
without sleeps, polling loops or leaving a deadlocked worker behind.

Generated and dependency config markers are ignored beneath the closest
registered workspace or primary configuration boundary. Both authored and
resolved physical paths are checked, preserving exclusions through symlinks.
A workspace whose own name is `build`, `target`, `dist` or `node_modules` still
observes its configuration. The corpus retains ordinary nested config changes
and open buffer versions as positive controls.

The native project workflow also watches its build-receipt/hash dependencies,
Canon editor transport and Maestro IDE sources. Explicit recursive patterns
cover the original nested CLI contracts and native process support modules.
The trigger test exercises those concrete paths rather than merely requiring
particular YAML strings. Original native contracts, process custody and budgets
remain unchanged. Actual product compilation and native qualification are
required on Actions before queue admission and release.
