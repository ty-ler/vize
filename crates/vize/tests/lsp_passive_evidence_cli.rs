//! Passive artifact controls; these are not Corsa or diagnostic correctness proof.
#![allow(
    clippy::disallowed_types,
    clippy::disallowed_macros,
    reason = "test-only JSON and filesystem controls use standard buffers"
)]

use std::{fs, path::PathBuf, process::Command};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[path = "support/lsp_process/passive.rs"]
#[allow(
    dead_code,
    reason = "the original LSP harness uses this shared helper's constructor and error reporter"
)]
mod passive;
use passive::Passive;

#[path = "support/lsp_process/process_state.rs"]
#[allow(dead_code, reason = "the LSP helper owns platform dispatch")]
mod process_state;

fn expected(terminal: Value) -> Value {
    json!({
        "schema":"vize-lsp-passive-terminal-evidence-v1",
        "process":{
            "pid":17,"declaredExecutable":"NONEXISTENT-PASSIVE-CONTROL",
            "arguments":["lsp"],"cwd":null,
            "sourceSha":std::env::var("SOURCE_SHA").ok(),
            "harnessPackageVersion":env!("CARGO_PKG_VERSION"),
            "identityScope":"original spawned LSP PID and declared command; no executable-byte or backend-PID join",
            "extraIdentityProbe":false
        },
        "observationTiming":"persisted after original teardown and reader joins",
        "terminalEvidence":terminal
    })
}

fn capture(root: PathBuf) -> Passive {
    let mut command = Command::new("NONEXISTENT-PASSIVE-CONTROL");
    command.arg("lsp");
    Passive::with_root(root, 17, &command)
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn passive_identity_has_no_probe_and_retains_the_entire_owned_packet() {
    let case = tempfile::tempdir().unwrap();
    let root = case.path().join("capture");
    let capture = capture(root.clone());
    assert_eq!(
        std::fs::read_dir(case.path()).unwrap().count(),
        0,
        "construction must not touch the filesystem"
    );
    let terminal = json!({
        "protocol":[
            {"direction":"request","message":{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}},
            {"direction":"response","message":{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///App.vue","diagnostics":[]}}}
        ],
        "stderrBytes":[112,104,97,115,101,10],
        "stderrUtf8":"phase\n",
        "exitCode":null,"exitSuccess":false,
        "stdoutReaderJoined":true,"stderrReaderJoined":true
    });
    let expected_bytes = serde_json::to_vec_pretty(&expected(terminal.clone())).unwrap();
    capture.persist(terminal).unwrap();
    assert_eq!(
        std::fs::read(root.join("evidence.json")).unwrap(),
        expected_bytes
    );
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(
        manifest,
        json!({
            "complete":true,"originalBytes":expected_bytes.len(),"persistedBytes":expected_bytes.len(),
            "limitBytes":4*1024*1024,"originalSha256":digest(&expected_bytes),"persistedSha256":digest(&expected_bytes),
            "representation":"decoded JSON messages and already-owned stderr bytes; not raw wire frames",
            "overflowMeaning":"incomplete observation, never an accepted whole packet"
        })
    );
}

#[test]
fn overflow_is_explicit_and_cannot_be_a_whole_packet() {
    let case = tempfile::tempdir().unwrap();
    let root = case.path().join("capture");
    let terminal = json!({"stderrUtf8":"x".repeat(5*1024*1024)});
    let entire = serde_json::to_vec_pretty(&expected(terminal.clone())).unwrap();
    capture(root.clone()).persist(terminal).unwrap();
    let prefix = std::fs::read(root.join("evidence.json")).unwrap();
    assert_eq!(prefix, entire[..4 * 1024 * 1024]);
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(
        manifest,
        json!({
            "complete":false,"originalBytes":entire.len(),"persistedBytes":4*1024*1024,
            "limitBytes":4*1024*1024,"originalSha256":digest(&entire),"persistedSha256":digest(&prefix),
            "representation":"decoded JSON messages and already-owned stderr bytes; not raw wire frames",
            "overflowMeaning":"incomplete observation, never an accepted whole packet"
        })
    );
}

#[test]
fn artifact_write_failure_is_reported_without_panicking_or_overwriting() {
    let case = tempfile::tempdir().unwrap();
    let root = case.path().join("existing-file");
    std::fs::write(&root, b"original unrelated bytes").unwrap();
    let result = capture(root.clone()).persist(json!({"exitSuccess":false}));
    assert_eq!(
        result.as_ref().err().map(std::io::Error::kind),
        Some(std::io::ErrorKind::AlreadyExists)
    );
    assert_eq!(std::fs::read(root).unwrap(), b"original unrelated bytes");
}

#[test]
#[cfg(unix)]
fn complete_thread_and_fd_observations_retain_original_bytes() {
    let case = tempfile::tempdir().unwrap();
    let process = case.path().join("17");
    let thread = process.join("task/19");
    fs::create_dir_all(&thread).unwrap();
    fs::create_dir(process.join("fd")).unwrap();
    std::os::unix::fs::symlink("pipe:[12345]", process.join("fd/0")).unwrap();
    for file in ["stat", "status", "wchan"] {
        fs::write(process.join(file), format!("process {file}\n")).unwrap();
    }
    let files = [
        "comm", "stat", "status", "wchan", "syscall", "stack", "children",
    ];
    let mut expected = serde_json::Map::new();
    for file in files {
        let bytes = format!("thread {file}\n").into_bytes();
        fs::write(thread.join(file), &bytes).unwrap();
        expected.insert(file.into(), json!({"complete":true,"bytes":bytes}));
    }
    let actual = process_state::from_proc(case.path(), 17);
    assert_eq!(
        actual["tasks"],
        json!({"complete":true,"entries":[{"name":"19","observation":expected}]})
    );
    assert_eq!(
        actual["fds"],
        json!({"complete":true,"entries":[{"name":"0","observation":{"target":"pipe:[12345]"}}]})
    );
    for file in ["stat", "status", "wchan"] {
        assert_eq!(
            actual[file],
            json!({"complete":true,"bytes":format!("process {file}\n").as_bytes()})
        );
    }
}

#[test]
#[cfg(unix)]
fn deadline_observation_does_not_kill_the_owned_child_or_replace_its_terminal_packet() {
    let case = tempfile::tempdir().unwrap();
    let root = case.path().join("capture");
    let mut command = Command::new("sh");
    command
        .args(["-c", "read line"])
        .stdin(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    let mut capture = Passive::with_root(root.clone(), child.id(), &command);
    capture.begin_exit_wait();
    capture.record_exit_deadline(child.id(), std::time::Duration::ZERO, true);
    // The helper observes; only the existing owner decides to kill and reap.
    let alive = child.try_wait().unwrap();
    child.kill().unwrap();
    let status = child.wait().unwrap();
    assert_eq!(alive, None);
    let terminal =
        json!({"originalFailure":"original deadline expired", "exitSuccess":status.success()});
    capture.persist(terminal.clone()).unwrap();
    let packet: Value =
        serde_json::from_slice(&fs::read(root.join("evidence.json")).unwrap()).unwrap();
    assert_eq!(packet["terminalEvidence"], terminal);
    let deadline: Value =
        serde_json::from_slice(&fs::read(root.join("exit-deadline.json")).unwrap()).unwrap();
    assert_eq!(deadline["pid"], child.id());
    assert_eq!(deadline["stdinOpen"], true);
    assert_eq!(deadline["originalTimeoutMillis"], 0);
    let lifecycle: Value =
        serde_json::from_slice(&fs::read(root.join("lifecycle.json")).unwrap()).unwrap();
    assert_eq!(lifecycle["pid"], child.id());
    assert!(
        lifecycle["terminalAfterSpawnMillis"].as_u64().unwrap()
            >= lifecycle["exitWaitStartedAfterSpawnMillis"]
                .as_u64()
                .unwrap()
    );
}

#[test]
fn missing_and_incomplete_observations_are_never_empty_successes() {
    let case = tempfile::tempdir().unwrap();
    let missing = process_state::from_proc(case.path(), 17);
    assert_eq!(missing["tasks"]["errorKind"], "NotFound");
    assert_eq!(missing["fds"]["errorKind"], "NotFound");
    let path = case.path().join("long");
    fs::write(&path, vec![b'x'; (64 * 1024) + 1]).unwrap();
    assert_eq!(
        process_state::read(&path),
        json!({"complete":false,"bytes":vec![b'x';(64 * 1024)]})
    );
    fs::create_dir(case.path().join("many")).unwrap();
    for item in ["1", "2"] {
        fs::write(case.path().join("many").join(item), b"").unwrap();
    }
    let limited =
        process_state::entries(&case.path().join("many"), 1, |_| json!({"observed":true}));
    assert_eq!(
        limited,
        json!({"complete":false,"entries":[{"name":"1","observation":{"observed":true}}]})
    );
}
