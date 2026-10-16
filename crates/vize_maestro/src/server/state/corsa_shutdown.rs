//! Final server shutdown captures and closes every cached native owner.
use super::ServerState;
use std::sync::Arc;
use vize_canon::CorsaBridge;
use vize_l0::{String, cstr};

impl ServerState {
    pub(crate) async fn shutdown_corsa_project_contexts(&self) -> Result<(), String> {
        let states = self.freeze_project_contexts_for_exit();
        let mut bridges: Vec<Arc<CorsaBridge>> = Vec::new();
        for state in std::iter::once(self).chain(states.iter().map(Arc::as_ref)) {
            if let Some(bridge) = state.corsa_bridge.write().take()
                && !bridges
                    .iter()
                    .any(|existing| Arc::ptr_eq(existing, &bridge))
            {
                bridges.push(bridge);
            }
        }
        // Ordinary configuration invalidation still retires immediately. Only
        // final protocol shutdown waits, retaining these exact process owners.
        self.retire_project_contexts();
        let outcomes =
            futures::future::join_all(bridges.iter().map(|bridge| bridge.shutdown_for_exit()))
                .await;
        let errors: Vec<_> = outcomes.into_iter().filter_map(Result::err).collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(cstr!(
                "Failed to close native project owners before LSP shutdown: {errors:?}"
            ))
        }
    }
}

#[cfg(test)]
mod tests;
