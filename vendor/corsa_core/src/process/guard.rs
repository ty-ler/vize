//! Exact child ownership and terminal acknowledgment.
use super::lifetime::{ProcessCloseReceipt, ProcessTerminalObserver};
use super::{terminate_child_process_receipt, wait_for_child_exit_receipt};
use crate::process_receipt::{ProcessObservation, ProcessTermination};
use crate::{CorsaError, Result, fast::CompactString};
use std::{
    process::Child,
    sync::{Arc, Mutex, TryLockError},
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

    /// Observe an already-terminal exact child before any close action.
    ///
    /// This never signals a process. Callers must freeze their first result for
    /// the owner epoch; later exit or shutdown must not reclassify an alive owner.
    /// A consumed child cannot create new proof, even if cached status exists.
    pub fn observe_preclose_terminal(
        self: &Arc<Self>,
    ) -> Result<Option<super::PreCloseTerminalProof>> {
        let mut owned = self.child.try_lock().map_err(|error| {
            CorsaError::Protocol(
                format!("preclose exact child custody unavailable: {error}").into(),
            )
        })?;
        let mut stderr = self.observation.try_lock().map_err(|error| {
            CorsaError::Protocol(format!("preclose stderr custody unavailable: {error}").into())
        })?;
        // Validate the same custody before try_wait without copying discarded evidence.
        self.terminal.try_check_custody_access()?;
        let child = owned.as_mut().ok_or_else(|| {
            CorsaError::Protocol("preclose exact child was already consumed".into())
        })?;
        let status = child.try_wait().map_err(|error| {
            CorsaError::Protocol(format!("preclose exact child try_wait failed: {error}").into())
        })?;
        let Some(status) = status else {
            return Ok(None);
        };
        let pid = child.id();
        // try_wait(Some) has already reaped this retained Child. Keep its actual
        // status and all stderr custody, including unsuccessful exits and SIG9.
        owned.take();
        self.cache_termination_observation(
            pid,
            ProcessTermination {
                status,
                timed_out: false,
                kill_requested: false,
            },
            Duration::from_secs(2),
            stderr.take(),
        )?;
        let observation = self.terminal.try_snapshot()?;
        super::preclose::PreCloseTerminalProof::new(Arc::clone(self), observation).map(Some)
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
        let observation = self
            .observation
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        self.cache_termination_observation(pid, terminal, drain, observation)
    }

    fn cache_termination_observation(
        &self,
        pid: u32,
        terminal: ProcessTermination,
        drain: Duration,
        observation: Option<ProcessObservation>,
    ) -> Result<()> {
        let receipt = ProcessCloseReceipt {
            pid,
            status: terminal.status,
            timed_out: terminal.timed_out,
            kill_requested: terminal.kill_requested,
            reaped: true,
        };
        let outcome = observation.map_or(Ok(()), |observation| {
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        os::unix::process::ExitStatusExt,
        process::{Command, Stdio},
        sync::Arc,
    };

    #[test]
    fn preclose_busy_or_poisoned_custody_never_manufactures_terminal_proof() {
        let child = Command::new("sh")
            .args(["-c", "exec cat"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("actual live child");
        let process = Arc::new(AsyncChildGuard::new(child));
        {
            let _held = process.child.lock().unwrap();
            assert!(
                process.observe_preclose_terminal().is_err(),
                "exact child lock is nonblocking"
            );
        }
        {
            let _held = process.observation.lock().unwrap();
            assert!(
                process.observe_preclose_terminal().is_err(),
                "stderr custody lock is nonblocking"
            );
        }
        let poisoned = Arc::clone(&process);
        assert!(
            std::thread::spawn(move || {
                let _held = poisoned.child.lock().unwrap();
                panic!("poison exact child custody before observation");
            })
            .join()
            .is_err()
        );
        assert!(process.observe_preclose_terminal().is_err());
        assert!(
            process.terminal_observer().snapshot().terminal.is_none(),
            "proof check never kills"
        );
        assert!(
            process.abort_receipt().is_err(),
            "cleanup retains original poison error"
        );
        assert!(process.terminal_observer().snapshot().custody_complete());
        assert!(
            process.observe_preclose_terminal().is_err(),
            "cleanup status cannot become proof"
        );
    }

    #[test]
    fn preclose_poisoned_stderr_custody_is_unknown_until_explicit_cleanup() {
        let child = Command::new("sh")
            .args(["-c", "exec cat"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("actual live child");
        let process = Arc::new(AsyncChildGuard::new(child));
        let poisoned = Arc::clone(&process);
        assert!(
            std::thread::spawn(move || {
                let _held = poisoned.observation.lock().unwrap();
                panic!("poison stderr custody before observation");
            })
            .join()
            .is_err()
        );
        assert!(process.observe_preclose_terminal().is_err());
        assert!(process.terminal_observer().snapshot().terminal.is_none());
        process
            .abort_receipt()
            .expect("existing cleanup recovers stderr lock");
        assert!(process.observe_preclose_terminal().is_err());
    }

    #[test]
    fn poisoned_owned_process_lock_still_kills_waits_and_reaps_with_explicit_poison_error() {
        let child = Command::new("sh")
            .args(["-c", "exec cat"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("actual owned process");
        let pid = child.id();
        let process = Arc::new(AsyncChildGuard::new(child));
        let poisoned = Arc::clone(&process);
        assert!(
            std::thread::spawn(move || {
                let _owned = poisoned.child.lock().unwrap();
                panic!("poison the actual owned process lock");
            })
            .join()
            .is_err()
        );
        let mut packets = Vec::new();
        for attempt in 0..2 {
            let error = process
                .abort_receipt()
                .expect_err("poison stays explicit after real reaping");
            let raw_error = error.to_string();
            match error {
                CorsaError::Join(message) => assert_eq!(message, "process guard lock poisoned"),
                other => panic!("wrong process lock failure: {other:?}"),
            }
            let observation = process.terminal_observer().snapshot();
            assert!(observation.custody_complete());
            assert_eq!(observation.expected_pid, pid);
            let terminal = observation.terminal.unwrap();
            assert_eq!(terminal.pid, pid);
            assert_eq!(terminal.status.signal(), Some(9));
            assert!(terminal.kill_requested && terminal.reaped && !terminal.timed_out);
            let owned = process
                .child
                .lock()
                .expect_err("actual mutex remains poisoned")
                .into_inner();
            assert!(owned.is_none(), "waited Child was actually removed");
            let packet = serde_json::json!({"attempt":attempt,"expectedPid":pid,"poisonError":raw_error,"childRemoved":owned.is_none(),"terminal":{"pid":terminal.pid,"status":format!("{:?}",terminal.status),"exitCode":terminal.status.code(),"signal":terminal.status.signal(),"killRequested":terminal.kill_requested,"timedOut":terminal.timed_out,"reaped":terminal.reaped}});
            eprintln!("actual poisoned owned process terminal: {packet}");
            packets.push(packet);
        }
        #[cfg(target_os = "linux")]
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
        if let Some(capture) = std::env::var_os("VIZE_SNAPSHOT_SOURCE_CAPTURE_DIR") {
            let capture = std::path::PathBuf::from(capture);
            std::fs::create_dir_all(&capture).unwrap();
            std::fs::write(
                capture.join("poisoned-owned-process-lock.json"),
                serde_json::to_vec_pretty(&packets).unwrap(),
            )
            .unwrap();
        }
    }

    fn original_access_check(process: &AsyncChildGuard) -> Result<()> {
        let mut owned = process.child.try_lock().map_err(|error| {
            CorsaError::Protocol(
                format!("preclose exact child custody unavailable: {error}").into(),
            )
        })?;
        let _stderr = process.observation.try_lock().map_err(|error| {
            CorsaError::Protocol(format!("preclose stderr custody unavailable: {error}").into())
        })?;
        process.terminal.try_snapshot()?;
        owned.as_mut().ok_or_else(|| {
            CorsaError::Protocol("preclose exact child was already consumed".into())
        })?;
        Ok(())
    }

    fn fault<T>(
        process: &Arc<AsyncChildGuard>,
        observer: &crate::ProcessObserver,
        index: usize,
        poison: bool,
        read: impl FnOnce() -> T,
    ) -> T {
        if index >= 4 {
            return observer.access_fault_for_test(index - 4, poison, read);
        }
        if index >= 2 {
            return process
                .terminal
                .access_fault_for_test(index - 2, poison, read);
        }
        if poison {
            let process = Arc::clone(process);
            assert!(
                std::thread::spawn(move || {
                    if index == 0 {
                        let _held = process.child.lock().unwrap();
                        panic!("poison child custody");
                    } else {
                        let _held = process.observation.lock().unwrap();
                        panic!("poison spawn stderr custody");
                    }
                })
                .join()
                .is_err()
            );
            read()
        } else if index == 0 {
            let _held = process.child.lock().unwrap();
            read()
        } else {
            let _held = process.observation.lock().unwrap();
            read()
        }
    }

    #[test]
    fn borrowed_precheck_keeps_first_fault_before_alive_or_consumed_child() {
        let pair = |process: &Arc<AsyncChildGuard>| {
            let old = original_access_check(process).unwrap_err().to_string();
            let new = process.observe_preclose_terminal().unwrap_err().to_string();
            assert_eq!(new, old, "whole original first-error precedence");
        };
        for index in 0..6 {
            for poison in [false, true] {
                let observer = crate::ProcessObserver::default();
                let owned = crate::CorsaCommand::new("sh")
                    .with_process_observer(observer.clone())
                    .spawn_guarded(["-c", "exec cat"])
                    .unwrap();
                fault(&owned.process, &observer, index, poison, || {
                    pair(&owned.process)
                });
                let _ = owned.process.abort_receipt();
                assert!(
                    owned
                        .process
                        .terminal_observer()
                        .snapshot()
                        .custody_complete()
                );
            }
        }
        for index in 0..5 {
            let observer = crate::ProcessObserver::default();
            let owned = crate::CorsaCommand::new("sh")
                .with_process_observer(observer.clone())
                .spawn_guarded(["-c", "exec cat"])
                .unwrap();
            fault(&owned.process, &observer, index + 1, true, || {
                fault(&owned.process, &observer, index, false, || {
                    pair(&owned.process)
                });
            });
            let _ = owned.process.abort_receipt();
        }
        let observer = crate::ProcessObserver::default();
        let owned = crate::CorsaCommand::new("sh")
            .with_process_observer(observer.clone())
            .spawn_guarded(["-c", "exec cat"])
            .unwrap();
        owned.process.abort_receipt().unwrap();
        fault(&owned.process, &observer, 2, false, || pair(&owned.process));
        pair(&owned.process);
    }
}
