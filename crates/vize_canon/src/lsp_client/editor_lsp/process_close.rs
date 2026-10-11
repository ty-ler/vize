//! Closing and reaping the native editor process.

use super::{EditorLspSession, configured_project};
use corsa::runtime::block_on;
use std::sync::atomic::Ordering;
use vize_l0::{String, cstr};

impl EditorLspSession {
    /// Complete the standard LSP lifecycle before closing and reaping the
    /// owned process. The responder remains alive until `shutdown` returns so
    /// server-initiated requests cannot deadlock the final response.
    pub(super) fn shutdown(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }

        let mut first_error = None;
        if let Err(error) = block_on(self.client.graceful_close()) {
            first_error = Some(cstr!(
                "Failed to gracefully close editor LSP process: {error}"
            ));
        }
        self.finish_close(first_error)
    }

    /// Tear down the editor process without waiting for a protocol shutdown
    /// response. Workspace file events use this path when the reusable editor
    /// project view has to be discarded before the next semantic request; a
    /// stuck old server must not block the foreground LSP notification queue.
    pub(super) fn discard(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }

        let mut first_error = None;
        if let Err(error) = block_on(self.client.close()) {
            first_error = Some(cstr!("Failed to close editor LSP process: {error}"));
        }
        self.finish_close(first_error)
    }

    fn finish_close(&mut self, mut first_error: Option<String>) -> Result<(), String> {
        // The owning process is already reaped: its socket peer must close
        // before the SDK joins the attached full-duplex reader.
        if let Some(api) = self.configured_api.take()
            && let Err(error) = api.close_attachment()
            && first_error.is_none()
        {
            first_error = Some(configured_project::configuration_error(error));
        }
        self.stop.store(true, Ordering::Relaxed);
        if let Some(responder) = self.responder.take()
            && responder.join().is_err()
            && first_error.is_none()
        {
            first_error = Some(cstr!("Editor LSP responder panicked during shutdown"));
        }
        self.closed = true;

        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Drop for EditorLspSession {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
