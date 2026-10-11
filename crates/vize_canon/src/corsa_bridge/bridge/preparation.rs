//! Prepare and synchronize on the existing owned native worker operation.

#[expect(
    clippy::disallowed_types,
    reason = "the existing bridge caller owner is shared across threads"
)]
use std::sync::Arc;
use std::sync::atomic::Ordering;

use super::{CorsaBridge, CorsaBridgeError};
use crate::corsa_client::CorsaProjectClient;

impl CorsaBridge {
    /// Preparation errors still precede native initialization errors. The
    /// retained caller lease prevents a cancelled preparation from entering IPC.
    pub(in crate::corsa_bridge) async fn with_prepared_client<P, R, Prepare, F>(
        &self,
        prepare: Prepare,
        operation: F,
    ) -> Result<R, CorsaBridgeError>
    where
        Prepare: FnOnce() -> Result<P, CorsaBridgeError> + Send + 'static,
        F: FnOnce(&mut CorsaProjectClient, P) -> Result<R, CorsaBridgeError> + Send + 'static,
        P: Send + 'static,
        R: Send + 'static,
    {
        let initialized = Arc::clone(&self.initialized);
        self.submit_ready_async(move |slot| {
            let prepared = prepare()?;
            crate::corsa_bridge::native_operation::checkpoint()
                .map_err(CorsaBridgeError::CommunicationError)?;
            if !initialized.load(Ordering::SeqCst) {
                return Err(CorsaBridgeError::NotInitialized);
            }
            match slot.as_mut() {
                Some(client) => operation(client, prepared),
                None => Err(CorsaBridgeError::ProcessTerminated),
            }
        })
        .await
    }
}

#[cfg(test)]
mod tests;
