//! Opt-in, lossless custody of one spawned process and its terminal result.

use std::{
    hash::{Hash, Hasher},
    io::{self, Read},
    process::{ChildStderr, ExitStatus},
    sync::{Arc, Mutex, mpsc},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

/// A snapshot of the evidence retained for an observed child.
#[derive(Clone, Debug)]
pub struct ProcessReceipt {
    pub pid: u32,
    pub completed: bool,
    pub stderr: Vec<u8>,
    pub stderr_complete: bool,
    pub stderr_error: Option<String>,
    pub exit_status: Option<ExitStatus>,
    pub process_error: Option<String>,
    pub timed_out: bool,
    pub kill_requested: bool,
    pub reaped: bool,
    pub elapsed: Duration,
}

/// Shared opt-in collection; captures bytes without interpreting or filtering them.
/// Equality and hashing depend on collection identity, never mutable contents.
#[derive(Clone, Default)]
pub struct ProcessObserver(Arc<Mutex<Vec<Arc<Mutex<ProcessReceipt>>>>>);

impl std::fmt::Debug for ProcessObserver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessObserver").finish_non_exhaustive()
    }
}
impl PartialEq for ProcessObserver {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for ProcessObserver {}
impl Hash for ProcessObserver {
    fn hash<H: Hasher>(&self, state: &mut H) {
        Arc::as_ptr(&self.0).hash(state);
    }
}

impl ProcessObserver {
    /// Returns full snapshots, including incomplete/error receipts.
    pub fn receipts(&self) -> Vec<ProcessReceipt> {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .map(|receipt| {
                receipt
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .clone()
            })
            .collect()
    }

    /// Proof capture refuses poisoned or unavailable custody instead of recovering it.
    pub(crate) fn try_receipts(&self) -> io::Result<Vec<ProcessReceipt>> {
        let receipts = self.0.try_lock().map_err(|error| {
            io::Error::other(format!("preclose stderr collection unavailable: {error}"))
        })?;
        receipts
            .iter()
            .map(|receipt| {
                receipt
                    .try_lock()
                    .map(|receipt| receipt.clone())
                    .map_err(|error| {
                        io::Error::other(format!("preclose stderr receipt unavailable: {error}"))
                    })
            })
            .collect()
    }

    /// Check the same ordered receipt locks without cloning a result vector.
    pub(crate) fn try_check_receipt_access(&self) -> io::Result<()> {
        let receipts = self.0.try_lock().map_err(|error| {
            io::Error::other(format!("preclose stderr collection unavailable: {error}"))
        })?;
        for receipt in receipts.iter() {
            let _receipt = receipt.try_lock().map_err(|error| {
                io::Error::other(format!("preclose stderr receipt unavailable: {error}"))
            })?;
        }
        Ok(())
    }

    pub(crate) fn start(&self, pid: u32, stderr: ChildStderr) -> io::Result<ProcessObservation> {
        let receipt = Arc::new(Mutex::new(ProcessReceipt {
            pid,
            completed: false,
            stderr: Vec::new(),
            stderr_complete: false,
            stderr_error: None,
            exit_status: None,
            process_error: None,
            timed_out: false,
            kill_requested: false,
            reaped: false,
            elapsed: Duration::ZERO,
        }));
        let reader_receipt = receipt.clone();
        let (done_tx, done) = mpsc::channel();
        let reader = thread::Builder::new()
            .name(format!("corsa-stderr-{pid}"))
            .spawn(move || {
                drain(stderr, &reader_receipt);
                let _ = done_tx.send(());
            })?;
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(receipt.clone());
        Ok(ProcessObservation {
            receipt,
            done,
            reader: Some(reader),
            started: Instant::now(),
        })
    }
}

fn drain(mut stderr: ChildStderr, receipt: &Mutex<ProcessReceipt>) {
    let mut bytes = [0; 8192];
    loop {
        match stderr.read(&mut bytes) {
            Ok(0) => {
                receipt
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .stderr_complete = true;
                return;
            }
            Ok(count) => receipt
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .stderr
                .extend_from_slice(&bytes[..count]),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                receipt
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .stderr_error = Some(error.to_string());
                return;
            }
        }
    }
}

/// Spawn-specific observation passed directly to the owning child guard.
/// No global registry or PID lookup is involved.
#[derive(Debug)]
pub struct ProcessObservation {
    receipt: Arc<Mutex<ProcessReceipt>>,
    done: mpsc::Receiver<()>,
    reader: Option<JoinHandle<()>>,
    started: Instant,
}

impl ProcessObservation {
    pub(crate) fn finish(
        mut self,
        pid: u32,
        result: io::Result<ProcessTermination>,
        drain_timeout: Duration,
    ) -> io::Result<()> {
        let expected_pid = self
            .receipt
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pid;
        let result = if expected_pid == pid {
            result
        } else {
            Err(io::Error::other(format!(
                "process receipt PID mismatch: observed {expected_pid}, guarded {pid}"
            )))
        };
        {
            let mut receipt = self
                .receipt
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            match result.as_ref() {
                Ok(terminal) => {
                    receipt.exit_status = Some(terminal.status);
                    receipt.timed_out = terminal.timed_out;
                    receipt.kill_requested = terminal.kill_requested;
                    receipt.reaped = true;
                }
                Err(error) => receipt.process_error = Some(error.to_string()),
            }
            receipt.elapsed = self.started.elapsed();
        }
        match self.done.recv_timeout(drain_timeout) {
            Ok(()) => {
                if let Some(reader) = self.reader.take() {
                    reader
                        .join()
                        .map_err(|_| io::Error::other("stderr reader panicked"))?;
                }
            }
            Err(_) => {
                self.receipt
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .stderr_error = Some("stderr did not reach EOF before drain deadline".into());
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "stderr drain deadline",
                ));
            }
        }
        let mut receipt = self
            .receipt
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !receipt.stderr_complete {
            return Err(io::Error::other(
                receipt.stderr_error.clone().unwrap_or_default(),
            ));
        }
        receipt.completed = result.is_ok();
        result.map(|_| ())
    }
}

pub(crate) struct ProcessTermination {
    pub(crate) status: ExitStatus,
    pub(crate) timed_out: bool,
    pub(crate) kill_requested: bool,
}

#[cfg(test)]
impl ProcessObserver {
    pub(crate) fn access_fault_for_test<T>(
        &self,
        index: usize,
        poison: bool,
        read: impl FnOnce() -> T,
    ) -> T {
        fn fault<T, U: Send + 'static>(
            lock: Arc<Mutex<U>>,
            poison: bool,
            read: impl FnOnce() -> T,
        ) -> T {
            if poison {
                assert!(
                    thread::spawn(move || {
                        let _held = lock.lock().unwrap();
                        panic!("poison receipt custody");
                    })
                    .join()
                    .is_err()
                );
                read()
            } else {
                let _held = lock.lock().unwrap();
                read()
            }
        }
        if index == 0 {
            fault(Arc::clone(&self.0), poison, read)
        } else {
            let receipt = Arc::clone(&self.0.lock().unwrap()[index - 1]);
            fault(receipt, poison, read)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> ProcessObserver {
        let observer = ProcessObserver::default();
        for pid in [41, 42] {
            observer
                .0
                .lock()
                .unwrap()
                .push(Arc::new(Mutex::new(ProcessReceipt {
                    pid,
                    completed: false,
                    stderr: vec![0, 255, 1],
                    stderr_complete: false,
                    stderr_error: None,
                    exit_status: None,
                    process_error: None,
                    timed_out: false,
                    kill_requested: false,
                    reaped: false,
                    elapsed: Duration::ZERO,
                })));
        }
        observer
    }

    fn paired(observer: &ProcessObserver) -> Option<(io::ErrorKind, String)> {
        let old = observer
            .try_receipts()
            .err()
            .map(|e| (e.kind(), e.to_string()));
        let new = observer
            .try_check_receipt_access()
            .err()
            .map(|e| (e.kind(), e.to_string()));
        assert_eq!(new, old, "same first refusal and whole text");
        new
    }

    #[test]
    fn borrowed_receipt_access_preserves_all_ordered_busy_and_poison_refusals() {
        assert!(paired(&ProcessObserver::default()).is_none());
        let complete = fixture();
        assert!(paired(&complete).is_none());
        assert_eq!(complete.try_receipts().unwrap().len(), 2);
        for index in 0..=2 {
            for poison in [false, true] {
                let observer = fixture();
                observer.access_fault_for_test(index, poison, || {
                    assert!(paired(&observer).is_some());
                });
            }
        }
        for first in [0, 1] {
            let observer = fixture();
            let receipts = observer.0.lock().unwrap().clone();
            let second = Arc::clone(&receipts[1]);
            assert!(
                thread::spawn(move || {
                    let _held = second.lock().unwrap();
                    panic!("later receipt is poisoned");
                })
                .join()
                .is_err()
            );
            if first == 0 {
                let _held = observer.0.lock().unwrap();
                let error = paired(&observer).unwrap();
                let raw = observer.0.try_lock().err().unwrap().to_string();
                assert_eq!(
                    error.1,
                    format!("preclose stderr collection unavailable: {raw}")
                );
            } else {
                let _held = receipts[0].lock().unwrap();
                let error = paired(&observer).unwrap();
                let raw = receipts[0].try_lock().err().unwrap().to_string();
                assert_eq!(
                    error.1,
                    format!("preclose stderr receipt unavailable: {raw}")
                );
            }
        }
    }
}
