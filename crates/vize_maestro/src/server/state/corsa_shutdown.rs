//! Final shutdown joins current owners and nonblocking configuration retirement.
use super::ServerState;
use std::sync::Arc;
use vize_canon::{CorsaBridge, NativePreCloseEpoch};
use vize_l0::{String, cstr};

mod retired;
pub(super) use retired::RetiredOwners;

#[derive(Default)]
pub(super) struct NativeShutdown {
    pending: Vec<Arc<CorsaBridge>>,
    /// None is a frozen active classification, never an invitation to re-probe.
    epochs: Vec<(Arc<CorsaBridge>, Option<NativePreCloseEpoch>)>,
    first_failure: Option<String>,
}

impl NativeShutdown {
    async fn classify_once<F, Probe>(&mut self, bridge: &Arc<CorsaBridge>, probe: F)
    where
        F: FnOnce() -> Probe,
        Probe: std::future::Future<Output = Option<NativePreCloseEpoch>>,
    {
        if self
            .epochs
            .iter()
            .any(|(owner, _)| Arc::ptr_eq(owner, bridge))
        {
            return;
        }
        // Cancellation before proof delivery freezes active, too. A retry
        // cannot observe the child killed by an intervening close as predead.
        self.epochs.push((Arc::clone(bridge), None));
        if let Some((_, classification)) = self.epochs.last_mut() {
            *classification = probe()
                .await
                .filter(|epoch| Arc::ptr_eq(epoch.bridge(), bridge));
        }
    }
}

impl ServerState {
    pub(super) fn freeze_corsa_owner_for_exit(&self) {
        // Serialize the final-exit marker with every cache publication/removal.
        let slot = self.corsa_bridge.write();
        self.corsa_finalizing
            .store(true, std::sync::atomic::Ordering::Release);
        if let Some(bridge) = slot.as_ref() {
            bridge.freeze_exit_admission();
        }
    }

    pub(crate) async fn shutdown_corsa_project_contexts(&self) -> Result<(), String> {
        // Serialize protocol and transport finalizers while retaining the exact
        // failed owner set. A retry must not mistake empty cache slots for a
        // previously acknowledged process close.
        let mut finalization = self.corsa_shutdown.lock().await;
        let states = self.freeze_project_contexts_for_exit();
        for state in std::iter::once(self).chain(states.iter().map(Arc::as_ref)) {
            if let Some(bridge) = state.corsa_bridge.write().take()
                && !finalization
                    .pending
                    .iter()
                    .any(|existing| Arc::ptr_eq(existing, &bridge))
            {
                finalization.pending.push(bridge);
            }
        }
        self.retire_project_contexts();
        let bridges = finalization.pending.clone();
        for bridge in &bridges {
            bridge.freeze_exit_admission();
        }
        // Finish every non-killing probe before starting any final cleanup.
        // This per-owner decision survives an active-close failure and retry.
        for bridge in &bridges {
            finalization
                .classify_once(bridge, || bridge.preexisting_exit_epoch())
                .await;
        }
        let mut active = Vec::new();
        for bridge in bridges {
            let epoch = finalization
                .epochs
                .iter()
                .find(|(owner, _)| Arc::ptr_eq(owner, &bridge))
                .and_then(|(_, epoch)| epoch.clone());
            match epoch {
                Some(epoch) => self.corsa_retired.retain_preexisting(epoch),
                None => active.push(bridge),
            }
        }
        let (outcomes, retired) = futures::join!(
            futures::future::join_all(active.iter().map(|bridge| bridge.shutdown_for_exit())),
            self.corsa_retired.close_for_exit(),
        );
        finalization.pending.clear();
        let mut errors = Vec::new();
        for (bridge, outcome) in active.into_iter().zip(outcomes) {
            if let Err(error) = outcome {
                finalization.pending.push(bridge);
                errors.push(error);
            }
        }
        if let Err(error) = retired {
            errors.push(vize_canon::CorsaBridgeError::CommunicationError(error));
        }
        let pending = finalization.pending.clone();
        finalization
            .epochs
            .retain(|(owner, _)| pending.iter().any(|bridge| Arc::ptr_eq(owner, bridge)));
        if !errors.is_empty() && finalization.first_failure.is_none() {
            finalization.first_failure = Some(cstr!(
                "Failed to close native project owners before LSP shutdown: {errors:?}"
            ));
        }
        match &finalization.first_failure {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests;
