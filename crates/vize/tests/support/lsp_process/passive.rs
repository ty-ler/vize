//! Opt-in persistence after the original process teardown, without identity probes.
#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    clippy::disallowed_macros,
    reason = "test-only passive custody uses standard files and JSON buffers"
)]

use std::{
    io,
    io::Write,
    path::PathBuf,
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const MAX_PERSISTED_BYTES: usize = 4 * 1024 * 1024;

#[path = "process_state.rs"]
mod process_state;

pub(super) struct Passive {
    root: PathBuf,
    identity: Value,
    created: Instant,
    created_at: u128,
    exit_wait: Option<Instant>,
}

impl Passive {
    pub(super) fn new(pid: u32, command: &Command) -> Option<Self> {
        let root = PathBuf::from(std::env::var_os("VIZE_LSP_PASSIVE_EVIDENCE")?)
            .join(format!("process-{pid}"));
        Some(Self::with_root(root, pid, command))
    }

    pub(super) fn with_root(root: PathBuf, pid: u32, command: &Command) -> Self {
        // Read only already-available command metadata. No filesystem access,
        // hashing, process probe or extra request precedes original initialize.
        Self {
            root,
            created: Instant::now(),
            created_at: unix_millis(),
            exit_wait: None,
            identity: json!({
                "pid":pid,
                "declaredExecutable":command.get_program().to_string_lossy(),
                "arguments":command.get_args().map(|arg|arg.to_string_lossy()).collect::<Vec<_>>(),
                "cwd":command.get_current_dir(),
                "sourceSha":std::env::var("SOURCE_SHA").ok(),
                "harnessPackageVersion":env!("CARGO_PKG_VERSION"),
                "identityScope":"original spawned LSP PID and declared command; no executable-byte or backend-PID join",
                "extraIdentityProbe":false
            }),
        }
    }

    pub(super) fn begin_exit_wait(&mut self) {
        self.exit_wait = Some(Instant::now());
    }

    /// Observe only after the original deadline; the caller still fails and
    /// kills/reaps its original child. No probe runs on the successful path.
    pub(super) fn record_exit_deadline(&self, pid: u32, timeout: Duration, stdin_open: bool) {
        let started_at = unix_millis();
        let snapshot = process_state::snapshot(pid);
        let packet = json!({
            "schema":"vize-lsp-exit-deadline-v1", "pid":pid,
            "observation":"after original exit deadline, before original kill; non-atomic proc reads",
            "observedAtUnixMillis":started_at,"finishedAtUnixMillis":unix_millis(),
            "processSpawnObservedAtUnixMillis":self.created_at,
            "elapsedSinceSpawnMillis":self.created.elapsed().as_millis(),
            "elapsedExitWaitMillis":self.exit_wait.map(|start|start.elapsed().as_millis()),
            "originalTimeoutMillis":timeout.as_millis(),"stdinOpen":stdin_open,
            "processState":snapshot,
            "llvmProfileFile":std::env::var_os("LLVM_PROFILE_FILE").map(|value|value.to_string_lossy().into_owned())
        });
        let result = (|| -> io::Result<()> {
            std::fs::create_dir_all(&self.root)?;
            std::fs::write(
                self.root.join("exit-deadline.json"),
                serde_json::to_vec_pretty(&packet)?,
            )
        })();
        if let Err(error) = result {
            let _ = writeln!(
                std::io::stderr().lock(),
                "passive LSP deadline evidence could not be persisted: {error}"
            );
        }
    }

    pub(super) fn persist_reporting_error(&self, terminal_evidence: Value) {
        if let Err(error) = self.persist(terminal_evidence) {
            // Observation errors must not replace an original assertion panic.
            let _ = writeln!(
                std::io::stderr().lock(),
                "passive LSP evidence could not be persisted: {error}"
            );
        }
    }

    pub(super) fn persist(&self, terminal_evidence: Value) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(&json!({
            "schema":"vize-lsp-passive-terminal-evidence-v1",
            "process":self.identity,
            "observationTiming":"persisted after original teardown and reader joins",
            "terminalEvidence":terminal_evidence
        }))?;
        // The original helper's in-memory buffers remain unchanged. Bound the
        // persisted artifact and mark overflow explicitly; a prefix is not a
        // complete packet and cannot qualify a successful diagnostic capture.
        let stored = bytes.len().min(MAX_PERSISTED_BYTES);
        let complete = stored == bytes.len();
        std::fs::create_dir_all(&self.root)?;
        std::fs::write(self.root.join("evidence.json"), &bytes[..stored])?;
        std::fs::write(
            self.root.join("manifest.json"),
            serde_json::to_vec_pretty(&json!({
                "complete":complete,
                "originalBytes":bytes.len(),
                "persistedBytes":stored,
                "limitBytes":MAX_PERSISTED_BYTES,
                "originalSha256":hex(&Sha256::digest(&bytes)),
                "persistedSha256":hex(&Sha256::digest(&bytes[..stored])),
                "representation":"decoded JSON messages and already-owned stderr bytes; not raw wire frames",
                "overflowMeaning":"incomplete observation, never an accepted whole packet"
            }))?,
        )?;
        std::fs::write(
            self.root.join("lifecycle.json"),
            serde_json::to_vec_pretty(&json!({
                "schema":"vize-lsp-passive-lifecycle-v1", "pid":self.identity["pid"],
                "processSpawnObservedAtUnixMillis":self.created_at,
                "terminalObservedAtUnixMillis":unix_millis(),
                "terminalAfterSpawnMillis":self.created.elapsed().as_millis(),
                "exitWaitStartedAfterSpawnMillis":self.exit_wait.map(|start|start.duration_since(self.created).as_millis()),
                "elapsedExitWaitMillis":self.exit_wait.map(|start|start.elapsed().as_millis()),
                "observation":"terminal after original teardown and reader joins; no process probe on success"
            }))?,
        )
    }
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(HEX[usize::from(byte >> 4)] as char);
        result.push(HEX[usize::from(byte & 15)] as char);
    }
    result
}
