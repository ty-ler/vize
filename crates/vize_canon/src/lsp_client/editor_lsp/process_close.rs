//! Closing and reaping the native editor process.

use super::{EditorLspSession, configured_project, native_shutdown, process_receipt};
use corsa::runtime::block_on;
use std::sync::atomic::Ordering;
use vize_l0::{String, cstr};

fn complete_close(
    result: Result<(), String>,
    receipt_result: Result<(), process_receipt::ReportError>,
) -> Result<(), String> {
    match (result, receipt_result) {
        // The actual protocol/close error already accounts for this failure.
        // A physically clean receipt must not invent a second process error.
        (Err(error), Err(process_receipt::ReportError::Unacknowledged)) => Err(error),
        (Err(error), Err(receipt_error)) => Err(cstr!("{error}; {}", receipt_error.into_message())),
        (result, receipt_result) => {
            result.and(receipt_result.map_err(|error| error.into_message()))
        }
    }
}

impl EditorLspSession {
    /// Complete the selected LSP lifecycle before closing and reaping the
    /// owned process. The responder remains alive until `shutdown` returns so
    /// server-initiated requests cannot deadlock the final response.
    pub(super) fn shutdown(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }

        let mut first_error = None;
        // Native 7.0.2's Exit dispatch races stdin EOF into context.Canceled.
        // Its authenticated initialize identity selects acknowledged Shutdown
        // then transport EOF. Other servers retain the SDK standard lifecycle.
        let close_result = block_on(native_shutdown::close(&self.client, self.shutdown_to_eof));
        let graceful_acknowledged = close_result.is_ok();
        if let Err(error) = close_result {
            first_error = Some(cstr!(
                "Failed to gracefully close editor LSP process: {error}"
            ));
        }
        let result = self.finish_close(first_error);
        let receipt_result =
            process_receipt::report(&self.process_observer, graceful_acknowledged, true);
        complete_close(result, receipt_result)
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
        let result = self.finish_close(first_error);
        let receipt_result = process_receipt::report(&self.process_observer, false, false);
        result.and(receipt_result.map_err(|error| error.into_message()))
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
        self.issued_completions.invalidate();

        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Drop for EditorLspSession {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            eprintln!("{error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use process_receipt::ReportError;

    #[test]
    fn close_keeps_protocol_failure_and_independent_physical_failures() {
        let rpc = cstr!(
            "Failed to gracefully close editor LSP process: rpc error -32603: controlled shutdown refusal"
        );
        let physical = cstr!("controlled physical receipt failure");
        for (close, receipt, expected) in [
            (Ok(()), Ok(()), Ok(())),
            (Err(rpc.clone()), Ok(()), Err(rpc.clone())),
            (
                Ok(()),
                Err(ReportError::Unacknowledged),
                Err(cstr!("Native editor shutdown was not acknowledged")),
            ),
            (
                Err(rpc.clone()),
                Err(ReportError::Unacknowledged),
                Err(rpc.clone()),
            ),
            (
                Ok(()),
                Err(ReportError::Physical(physical.clone())),
                Err(physical.clone()),
            ),
            (
                Err(rpc.clone()),
                Err(ReportError::Physical(physical.clone())),
                Err(cstr!("{rpc}; {physical}")),
            ),
        ] {
            assert_eq!(complete_close(close, receipt), expected);
        }
    }
}
