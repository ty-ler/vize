//! Immutable proof that one retained child was terminal before close began.
use super::{AsyncChildGuard, ProcessCloseObservation, ProcessTerminalObserver};
use crate::{CorsaError, Result};
use std::sync::Arc;

/// Proof of a preexisting terminal epoch, never a clean-close verdict.
///
/// Fields are private so cached status, PID lookup, and later owner shutdown
/// cannot manufacture proof. Retain the first proof or alive/unknown decision
/// across retries; this type does not decide which application epoch is retired.
#[derive(Clone, Debug)]
pub struct PreCloseTerminalProof {
    process: Arc<AsyncChildGuard>,
    observer: ProcessTerminalObserver,
    observation: ProcessCloseObservation,
}

impl PreCloseTerminalProof {
    pub(super) fn new(
        process: Arc<AsyncChildGuard>,
        observation: ProcessCloseObservation,
    ) -> Result<Self> {
        if !preexisting_terminal(&observation) {
            return Err(CorsaError::Protocol(
                "preclose terminal proof has incomplete or close-induced custody".into(),
            ));
        }
        Ok(Self {
            observer: process.terminal_observer(),
            process,
            observation,
        })
    }

    /// Frozen full status, raw errors, and stderr bytes, including failed exits.
    pub fn observation(&self) -> &ProcessCloseObservation {
        &self.observation
    }

    /// Accept only the exact retained guard's observer and frozen spawn epoch.
    /// PID equality alone never identifies an owner. A match does not mean clean.
    pub fn matches(&self, observer: &ProcessTerminalObserver, spawn_sequence: u64) -> bool {
        self.process.terminal_observer().same_owner(&self.observer)
            && self.observer.same_owner(observer)
            && self.observation.spawn_sequence == spawn_sequence
            && preexisting_terminal(&self.observation)
    }
}

fn preexisting_terminal(observation: &ProcessCloseObservation) -> bool {
    observation.custody_complete()
        && observation
            .stderr_receipts
            .as_ref()
            .is_some_and(|receipts| receipts.len() == 1)
        && observation.terminal.as_ref().is_some_and(|terminal| {
            terminal.pid == observation.expected_pid
                && terminal.reaped
                && !terminal.kill_requested
                && !terminal.timed_out
        })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{CorsaCommand, ProcessLifetimeObserver, ProcessObserver};
    use std::{
        os::unix::process::ExitStatusExt,
        time::{Duration, Instant},
    };

    fn wait_for_stderr_eof(observer: &ProcessObserver) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let receipts = observer.receipts();
            if receipts.len() == 1 && receipts[0].stderr_complete {
                return;
            }
            assert!(Instant::now() < deadline, "actual stderr must reach EOF");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn observe_terminal(process: &Arc<AsyncChildGuard>) -> PreCloseTerminalProof {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match process
                .observe_preclose_terminal()
                .expect("actual child observation")
            {
                Some(proof) => return proof,
                None => {
                    assert!(
                        Instant::now() < deadline,
                        "actual child must exit without owner kill"
                    );
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
    }

    #[test]
    fn preexisting_sig9_keeps_full_binary_stderr_raw_errors_and_exact_identity() {
        let stderr = ProcessObserver::default();
        let command = CorsaCommand::new("sh")
            .with_process_observer(stderr.clone())
            .with_lifetime_observer(ProcessLifetimeObserver::default(), "preclose-sig9");
        let owned = command.spawn_guarded([
            "-c",
            "i=0; while [ \"$i\" -lt 8192 ]; do printf '\\377\\000payload' >&2; i=$((i+1)); done; kill -KILL $$",
        ]).expect("actual independently exiting child");
        let process = owned.process;
        let observer = process.terminal_observer();
        observer.record_error("preexisting RPC error retained verbatim");
        wait_for_stderr_eof(&stderr);
        let proof = observe_terminal(&process);
        let observation = proof.observation();
        assert!(proof.matches(&observer, observation.spawn_sequence));
        assert!(!proof.matches(&observer, observation.spawn_sequence + 1));
        let impostor = ProcessTerminalObserver::new(observation.expected_pid, Default::default());
        assert!(!proof.matches(&impostor, observation.spawn_sequence));
        assert_eq!(
            observation.raw_errors,
            ["preexisting RPC error retained verbatim"]
        );
        let terminal = observation.terminal.as_ref().expect("actual reaped status");
        assert_eq!(terminal.status.signal(), Some(9));
        assert!(terminal.reaped && !terminal.kill_requested && !terminal.timed_out);
        assert!(
            !terminal.status.success(),
            "retired does not mean successful exit"
        );
        let receipt = &observation
            .stderr_receipts
            .as_ref()
            .expect("full stderr custody")[0];
        assert_eq!(receipt.stderr, b"\xff\0payload".repeat(8192));
        assert!(receipt.completed && receipt.stderr_complete && receipt.reaped);
        assert!(
            process.observe_preclose_terminal().is_err(),
            "consumed Child cannot mint another proof"
        );
        process
            .abort_receipt()
            .expect("cached close remains available");
        assert!(
            proof.matches(&observer, observation.spawn_sequence),
            "retained proof survives retry"
        );
    }

    #[test]
    fn alive_observation_does_not_kill_and_later_owner_kill_cannot_create_proof() {
        let owned = CorsaCommand::new("sh")
            .spawn_guarded(["-c", "exec cat"])
            .expect("actual live child with retained input");
        assert!(owned.process.observe_preclose_terminal().unwrap().is_none());
        assert!(
            owned
                .process
                .terminal_observer()
                .snapshot()
                .terminal
                .is_none()
        );
        let closed = owned
            .process
            .abort_receipt()
            .expect("explicit cleanup")
            .unwrap();
        assert!(closed.kill_requested && closed.reaped);
        assert_eq!(closed.status.signal(), Some(9));
        assert!(
            owned.process.observe_preclose_terminal().is_err(),
            "own close is never preexisting death"
        );
    }

    #[test]
    fn terminal_without_observed_stderr_cannot_retire_an_owner() {
        let owned = CorsaCommand::new("sh")
            .spawn_guarded(["-c", "exit 0"])
            .expect("actual unobserved child");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match owned.process.observe_preclose_terminal() {
                Err(error) => {
                    assert!(
                        error
                            .to_string()
                            .contains("incomplete or close-induced custody")
                    );
                    break;
                }
                Ok(None) => {
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(5));
                }
                Ok(Some(_)) => panic!("inherited stderr has no complete receipt"),
            }
        }
        assert!(
            owned.process.observe_preclose_terminal().is_err(),
            "cached status cannot fill missing custody"
        );
        assert!(
            owned
                .process
                .terminal_observer()
                .snapshot()
                .terminal
                .is_some(),
            "actual status stays visible despite refusal"
        );
    }

    #[test]
    fn incomplete_frozen_custody_never_matches_as_proof() {
        let stderr = ProcessObserver::default();
        let owned = CorsaCommand::new("sh")
            .with_process_observer(stderr.clone())
            .spawn_guarded(["-c", "exit 7"])
            .expect("actual nonzero child");
        wait_for_stderr_eof(&stderr);
        let proof = observe_terminal(&owned.process);
        assert_eq!(
            proof.observation().terminal.as_ref().unwrap().status.code(),
            Some(7)
        );
        let mut incomplete = proof.observation().clone();
        incomplete.close_error = Some("stderr drain deadline".into());
        assert!(!preexisting_terminal(&incomplete));
        incomplete.close_error = None;
        incomplete.terminal.as_mut().unwrap().kill_requested = true;
        assert!(!preexisting_terminal(&incomplete));
        incomplete.terminal.as_mut().unwrap().kill_requested = false;
        incomplete.expected_pid += 1;
        assert!(!preexisting_terminal(&incomplete));
    }
}
