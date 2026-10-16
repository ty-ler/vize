//! Final server termination waits for the actual session owner to close.
#![expect(
    clippy::disallowed_types,
    reason = "final cleanup retains the worker-owned shared lifecycle"
)]
use super::{Arc, CorsaBridge, CorsaBridgeError, Ordering};

impl CorsaBridge {
    /// Close the worker-owned client before acknowledging server termination.
    /// Unlike ordinary shutdown, an unfinished startup or abandoned operation
    /// must drain before this cleanup enters. The configured deadline still
    /// bounds the caller; a timeout is an error, never a successful close.
    pub async fn shutdown_for_exit(&self) -> Result<(), CorsaBridgeError> {
        self.finalizing.store(true, Ordering::Release);
        let initialized = Arc::clone(&self.initialized);
        let editor_session = Arc::clone(&self.editor_session);
        self.submit_ready_async(move |slot| {
            let outcome = match slot.as_mut() {
                Some(client) => client
                    .shutdown()
                    .map_err(CorsaBridgeError::CommunicationError),
                None => Ok(()),
            };
            *slot = None;
            editor_session.clear();
            initialized.store(false, Ordering::SeqCst);
            outcome
        })
        .await
    }
}

#[cfg(test)]
mod tests;
