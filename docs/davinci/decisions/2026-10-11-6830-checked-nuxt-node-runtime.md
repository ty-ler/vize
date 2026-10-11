# Checked Nuxt preparation runtime

Tracking: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The original composed App check at `888a4898a86a0fccfda99490e532eb407fc79157`
failed preparation before the Vue Fes check body. Its pinned manifest requires
Node `22`; its unchanged `.npmrc` enforces that contract. The actual provider
ran under Node `24.14.0`. Keep this failed run and whole preparation receipt.

Select a side runtime only when the checked authored manifest says exactly
`engines.node: "22"`. App runtime setup supplies the real executable through
`VIZE_APP_CHECK_PREPARE_NODE22`; an already running Node 22 can supply itself.
Refuse absent, relative, shim-switched, or wrong-major executables. Observe the
actual executable/version/SHA and distribution npx entry/SHA before install.
Prepend that distribution's bin and matching `VP_NODE_VERSION` only to the
original install and Nuxt prepare child environment. The caller and checker
keep their original runtime. Other authored engine contracts are unchanged.

Keep both preparation argument arrays, checked root, source census, module
hooks, configuration, lock restoration, failure outcomes and deadlines. The
install remains unlocked; its resolved lock and installed candidates stay
distinct from original authored bytes and native execution authority. Runtime
controls prove real executable selection and child scope, not Nuxt completion.

The action pin `voidzero-dev/setup-vp@ca1c466` pins the action, but its default
CLI input is dynamic `latest`. Original execution installed `vp v1.1.0`.
Its tagged source permits side provisioning after the existing repository
runtime setup: `vp env install 22`, then `vp env exec --node 22 node -p`
with a JSON expression reporting `process.execPath` and `process.version`.
The [request parser](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/crates/vp_global_cli/src/commands/env/spec.rs)
selects Node only. [Install](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/crates/vp_global_cli/src/commands/env/lifecycle.rs)
downloads the runtime without changing pins/default/session. [Explicit exec](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/crates/vp_global_cli/src/commands/env/exec.rs)
scopes selection to its child; it can also resolve/cache the selected package
manager. Retain actual CLI version and selection before/after at execution.

TODO: the sole App publisher wires this provision/export into both the existing
shared check-row setup and its composed qualifier, without a new workflow or
checker runtime change. Genuine original full App preparation/check acceptance
is pending. npmX's exact Lunaria URL still returns 404 and is a separate blocker;
no alternate package or lock-field change is authorized by this runtime repair.
