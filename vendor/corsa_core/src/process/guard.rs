//! Exact child ownership and terminal acknowledgment.
use super::lifetime::{ProcessCloseReceipt, ProcessTerminalObserver};
use super::{terminate_child_process_receipt, wait_for_child_exit_receipt};
use crate::process_receipt::{ProcessObservation, ProcessTermination};
use crate::{CorsaError, Result, fast::CompactString};
use std::{
    process::Child,
    sync::{Mutex, TryLockError},
    time::Duration,
};

/// Owns a child process and guarantees it is eventually terminated.
///
/// This guard exists to keep long-running editors, tests, and benchmarks from
/// leaking Corsa subprocesses. Shutdown attempts a graceful wait first and
/// then forcefully kills and reaps the child when necessary.
#[derive(Debug)]
pub struct AsyncChildGuard {
    child: Mutex<Option<Child>>,
    observation: Mutex<Option<ProcessObservation>>,
    terminal: ProcessTerminalObserver,
}

impl AsyncChildGuard {
    /// Abort this exact owned child and acknowledge its wait/reap completion.
    /// This lock is independent of every protocol request and handshake.
    pub fn abort(&self) -> Result<()> {
        self.abort_receipt().map(|_| ())
    }

    pub fn abort_receipt(&self) -> Result<Option<ProcessCloseReceipt>> {
        let (mut owned, poisoned) = match self.child.lock() {
            Ok(child) => (child, false),
            Err(poisoned) => (poisoned.into_inner(), true),
        };
        if let Some(mut child) = owned.take() {
            let terminal = match terminate_child_process_receipt(&mut child, false) {
                Ok(terminal) => terminal,
                Err(error) => {
                    let pid = child.id();
                    self.terminal
                        .record_error(format!("owned startup abort PID {pid} failed: {error}"));
                    *owned = Some(child);
                    return Err(CorsaError::Protocol(
                        format!("owned startup abort PID {pid} failed: {error}").into(),
                    ));
                }
            };
            self.cache_termination(child.id(), terminal, Duration::from_secs(2))?;
        }
        if poisoned {
            return Err(process_guard_poisoned());
        }
        let observed = self.terminal.snapshot();
        match observed.close_error {
            Some(error) => Err(CorsaError::Protocol(error.into())),
            None => Ok(observed.terminal),
        }
    }

    pub fn terminal_observer(&self) -> ProcessTerminalObserver {
        self.terminal.clone()
    }

    pub(super) fn set_observation(&self, observation: ProcessObservation) {
        *self
            .observation
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(observation);
    }

    fn cache_termination(
        &self,
        pid: u32,
        terminal: ProcessTermination,
        drain: Duration,
    ) -> Result<()> {
        let receipt = ProcessCloseReceipt {
            pid,
            status: terminal.status,
            timed_out: terminal.timed_out,
            kill_requested: terminal.kill_requested,
            reaped: true,
        };
        let outcome = self
            .observation
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
            .map_or(Ok(()), |observation| {
                observation.finish(pid, Ok(terminal), drain)
            });
        let error = outcome
            .as_ref()
            .err()
            .map(|error| format!("owned terminal {receipt:?}; stderr custody error: {error}"));
        self.terminal.finish(receipt, error.clone());
        match error {
            Some(error) => Err(CorsaError::Protocol(error.into())),
            None => Ok(()),
        }
    }

    /// Wraps a running child process.
    pub fn new(child: Child) -> Self {
        Self::new_observed(child, None)
    }

    /// Owns the observation returned alongside this exact child.
    pub fn new_observed(child: Child, observation: Option<ProcessObservation>) -> Self {
        let terminal = ProcessTerminalObserver::new(child.id(), CompactString::default());
        Self::new_guarded(child, observation, terminal)
    }

    pub(super) fn new_guarded(
        child: Child,
        observation: Option<ProcessObservation>,
        terminal: ProcessTerminalObserver,
    ) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            observation: Mutex::new(observation),
            terminal,
        }
    }

    /// Waits for graceful exit and force-kills the process when the deadline expires.
    ///
    /// The process is always reaped before this method returns successfully.
    pub async fn shutdown(&self, wait_for: Duration) -> Result<()> {
        let (mut owned, poisoned) = match self.child.lock() {
            Ok(child) => (child, false),
            Err(poisoned) => (poisoned.into_inner(), true),
        };
        let Some(mut child) = owned.take() else {
            if poisoned {
                return Err(process_guard_poisoned());
            }
            return match self.terminal.snapshot().close_error {
                Some(error) => Err(CorsaError::Protocol(error.into())),
                None => Ok(()),
            };
        };
        let terminal = match wait_for_child_exit_receipt(&mut child, wait_for) {
            Ok(terminal) => terminal,
            Err(error) => {
                let pid = child.id();
                self.terminal
                    .record_error(format!("owned shutdown PID {pid} failed: {error}"));
                *owned = Some(child);
                return Err(CorsaError::Protocol(
                    format!("owned shutdown PID {pid} failed: {error}").into(),
                ));
            }
        };
        self.cache_termination(child.id(), terminal, wait_for)?;
        if poisoned {
            return Err(process_guard_poisoned());
        }
        Ok(())
    }
}

impl Drop for AsyncChildGuard {
    fn drop(&mut self) {
        let mut child = match self.child.try_lock() {
            Ok(child) => child,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => {
                self.terminal
                    .record_error("owner Drop could not acquire exact child custody");
                return;
            }
        };
        if let Some(child) = child.as_mut() {
            match terminate_child_process_receipt(child, false) {
                Ok(terminal) => {
                    let _ = self.cache_termination(child.id(), terminal, Duration::from_secs(2));
                }
                Err(error) => self.terminal.record_error(format!(
                    "owner Drop PID {} failed to kill/wait/reap: {error}",
                    child.id()
                )),
            }
        }
    }
}

fn process_guard_poisoned() -> CorsaError {
    CorsaError::Join(CompactString::from("process guard lock poisoned"))
}
