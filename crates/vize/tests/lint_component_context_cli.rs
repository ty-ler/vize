//! Actual CLI and JSON-RPC consumers of the original explicit-context corpus.
#![cfg(test)]
#![allow(
    clippy::disallowed_types,
    clippy::disallowed_macros,
    reason = "integration fixtures preserve whole standard JSON and source strings"
)]

#[path = "component_context/cli.rs"]
mod cli;
#[cfg(feature = "maestro")]
#[path = "component_context/lsp.rs"]
mod lsp;
#[cfg(feature = "maestro")]
#[path = "support/lsp_process.rs"]
mod lsp_process;
#[path = "component_context/support.rs"]
mod support;
