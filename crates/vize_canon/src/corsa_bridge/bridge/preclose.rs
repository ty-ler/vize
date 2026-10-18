//! A frozen, pre-cleanup distinction between an active owner and a past epoch.
use super::{Arc, CorsaBridge, CorsaBridgeError, Ordering};
use corsa::process::PreCloseTerminalProof;
use serde_json::{Value, json};
use std::time::Duration;

/// Only the exact worker-owned children can construct this retirement capability.
/// Holding it retains their guards and whole immutable preclose observations.
#[derive(Clone)]
pub struct NativePreCloseEpoch {
    bridge: Arc<CorsaBridge>,
    proofs: Vec<PreCloseTerminalProof>,
    attachments: Vec<Value>,
}

impl NativePreCloseEpoch {
    pub fn bridge(&self) -> &Arc<CorsaBridge> {
        &self.bridge
    }

    pub fn receipt(&self) -> Value {
        json!({
            "criterion": "exact owned Child.try_wait before final cleanup",
            "children": self.proofs.iter().map(|proof| {
                crate::lsp_client::retirement::observation_json(proof.observation())
            }).collect::<Vec<_>>(),
            "attachedBindings": self.attachments,
        })
    }
}

impl CorsaBridge {
    /// Called for every cached root during the global admission freeze.
    /// Never abort, send a request, kill or close a process on this path.
    pub fn freeze_exit_admission(&self) -> bool {
        self.finalizing.store(true, Ordering::Release);
        *self
            .exit_admission
            .get_or_init(|| self.startup_control.freeze_for_exit())
    }

    /// A missing proof keeps the existing strict active-shutdown contract.
    /// The finalizer calls this once and retains its classification on retry.
    pub async fn preexisting_exit_epoch(self: &Arc<Self>) -> Option<NativePreCloseEpoch> {
        if !self.freeze_exit_admission() || self.worker.is_draining() {
            return None;
        }
        let control = self.startup_control.clone();
        let deadline = Duration::from_millis(self.config.timeout_ms.max(1));
        let result = self
            .submit_ready_with_bound(deadline, move |slot| {
                if control.startup_custody_pending() {
                    return Err(CorsaBridgeError::ProcessTerminated);
                }
                let owners = slot
                    .as_ref()
                    .ok_or(CorsaBridgeError::NotInitialized)?
                    .retirement_owners();
                let unpublished = control
                    .preclose_observers()
                    .map_err(CorsaBridgeError::CommunicationError)?;
                let proofs = owners
                    .preclose_proofs(&unpublished)
                    .map_err(CorsaBridgeError::CommunicationError)?;
                Ok((proofs, owners.attached_bindings))
            })
            .await;
        match result {
            Ok((proofs, attachments)) => Some(NativePreCloseEpoch {
                bridge: Arc::clone(self),
                proofs,
                attachments,
            }),
            Err(error) => {
                tracing::debug!(error = %error, "native preclose epoch remains active");
                None
            }
        }
    }
}
