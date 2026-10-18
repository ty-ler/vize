//! Final acknowledgment must wait for entered startup even after its caller left.
use crate::corsa_bridge::{CorsaBridge, CorsaBridgeConfig};
use futures::FutureExt;
use std::{
    sync::{Arc, atomic::Ordering, mpsc},
    time::Duration,
};

#[cfg(target_os = "linux")]
#[path = "../../../tests/support/original_diagnosing_process.rs"]
mod physical;

#[cfg(target_os = "linux")]
fn native_owner() -> (
    tempfile::TempDir,
    Arc<CorsaBridge>,
    physical::ProcessLife,
    corsa_lsp::LspClient,
    corsa::process::ProcessTerminalObserver,
) {
    use crate::lsp_client::retirement::CloseHandle;
    let root = tempfile::tempdir().unwrap();
    physical::write_fixture(root.path(), &physical::fixture());
    let native = physical::runtime();
    let bridge = Arc::new(CorsaBridge::with_config_and_package_routes(
        CorsaBridgeConfig {
            corsa_path: Some(native.clone()),
            working_dir: Some(root.path().to_path_buf()),
            timeout_ms: 10_000,
            ..Default::default()
        },
        crate::PackageRouteResolver::default(),
    ));
    futures::executor::block_on(bridge.spawn()).unwrap();
    let life = physical::native_lsp(root.path(), &native);
    let owners = futures::executor::block_on(
        bridge.submit_ready_async(|slot| Ok(slot.as_ref().unwrap().retirement_owners())),
    )
    .unwrap();
    assert_eq!(owners.handles.len(), 1);
    let CloseHandle::Editor(editor) = owners.handles.into_iter().next().unwrap() else {
        panic!("the configured project and editor must share one actual native owner");
    };
    let corsa::process::ProcessOwnership::Owned(observer) = editor.process_ownership() else {
        panic!("native editor must own its process");
    };
    assert_eq!(observer.snapshot().expected_pid, life.pid);
    (root, bridge, life, editor, observer)
}

#[cfg(target_os = "linux")]
fn kill_before_close(life: &physical::ProcessLife) {
    let proc = std::path::PathBuf::from(format!("/proc/{}", life.pid));
    let stat = std::fs::read_to_string(proc.join("stat")).unwrap();
    let birth: u64 = stat
        .rsplit_once(") ")
        .unwrap()
        .1
        .split_whitespace()
        .nth(19)
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(birth, life.birth);
    assert_eq!(
        std::fs::read_link(proc.join("exe")).unwrap(),
        life.executable
    );
    // No await separates exact birth/image verification from this signal.
    assert_eq!(
        unsafe { libc::kill(i32::try_from(life.pid).unwrap(), libc::SIGKILL) },
        0
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let stat = std::fs::read_to_string(proc.join("stat")).unwrap();
        let fields: Vec<_> = stat
            .rsplit_once(") ")
            .unwrap()
            .1
            .split_whitespace()
            .collect();
        assert_eq!(fields[19].parse::<u64>().unwrap(), life.birth);
        if fields[0] == "Z" {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "controlled child must exit before the probe"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(target_os = "linux")]
fn retain_real_rpc_failure(
    editor: &corsa_lsp::LspClient,
    observer: &corsa::process::ProcessTerminalObserver,
) -> Vec<std::string::String> {
    use lsp_types::request::Shutdown;
    let first = futures::executor::block_on(editor.request_without_params::<Shutdown>())
        .unwrap_err()
        .to_string();
    let settled = futures::executor::block_on(editor.request_without_params::<Shutdown>())
        .unwrap_err()
        .to_string();
    assert_eq!(settled, "process is closed: jsonrpc connection");
    let errors = vec![first, settled];
    for error in &errors {
        observer.record_error(error.clone());
    }
    errors
}

#[cfg(target_os = "linux")]
fn capture_preclose_case(name: &str, packet: &serde_json::Value) {
    eprintln!("native preclose {name}: {packet}");
    if let Some(directory) = std::env::var_os("VIZE_SNAPSHOT_SOURCE_CAPTURE_DIR") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join(format!("preclose-{name}.json")),
            serde_json::to_vec_pretty(packet).unwrap(),
        )
        .unwrap();
    }
}

#[test]
#[cfg(target_os = "linux")]
#[ignore = "requires the actual pinned native provider and physical Linux custody"]
fn native_preclose_unused_foreign_keeps_failed_evidence_and_live_owner_clean() {
    use serde_json::json;
    use std::os::unix::process::ExitStatusExt;
    if !physical::enabled() {
        return;
    }
    let (_foreign_root, foreign, foreign_life, foreign_editor, foreign_observer) = native_owner();
    let (_live_root, live, live_life, _live_editor, live_observer) = native_owner();
    kill_before_close(&foreign_life);
    let original_errors = retain_real_rpc_failure(&foreign_editor, &foreign_observer);
    assert!(foreign.freeze_exit_admission());
    assert!(live.freeze_exit_admission());
    let epoch = futures::executor::block_on(foreign.preexisting_exit_epoch()).unwrap();
    assert!(Arc::ptr_eq(epoch.bridge(), &foreign));
    assert!(futures::executor::block_on(live.preexisting_exit_epoch()).is_none());
    let frozen = foreign_observer.snapshot();
    assert!(frozen.custody_complete());
    assert_eq!(frozen.raw_errors, original_errors);
    let terminal = frozen.terminal.as_ref().unwrap();
    assert_eq!(
        (
            terminal.pid,
            terminal.status.signal(),
            terminal.reaped,
            terminal.kill_requested,
            terminal.timed_out
        ),
        (foreign_life.pid, Some(9), true, false, false)
    );
    assert_eq!(
        epoch.receipt()["children"],
        json!([crate::lsp_client::retirement::observation_json(&frozen)])
    );
    let retired = futures::executor::block_on(foreign.shutdown_for_retirement()).unwrap();
    assert!(retired.custody_complete);
    assert_eq!(
        retired.receipt["children"][0]["stderrCustody"],
        epoch.receipt()["children"][0]["stderrCustody"]
    );
    assert_eq!(
        retired.receipt["children"][0]["terminal"],
        epoch.receipt()["children"][0]["terminal"]
    );
    let post_close = foreign_observer.snapshot();
    assert_eq!(
        post_close.raw_errors.get(..original_errors.len()),
        Some(original_errors.as_slice())
    );
    assert_eq!(
        retired.receipt["children"][0]["raw_errors"],
        json!(post_close.raw_errors)
    );
    assert_eq!(retired.receipt["raw_errors"], json!(retired.raw_errors));
    let published_errors: Vec<_> = retired
        .raw_errors
        .iter()
        .map(|error| error.as_str())
        .collect();
    let original_and_close_errors: Vec<_> = post_close
        .raw_errors
        .iter()
        .map(|error| error.as_str())
        .collect();
    assert!(published_errors.len() >= original_and_close_errors.len());
    assert_eq!(
        published_errors.get(published_errors.len() - original_and_close_errors.len()..),
        Some(original_and_close_errors.as_slice())
    );
    assert!(futures::executor::block_on(live.shutdown_for_exit()).is_ok());
    let live_terminal = live_observer.snapshot().terminal.unwrap();
    assert_eq!(
        (
            live_terminal.pid,
            live_terminal.status.code(),
            live_terminal.reaped,
            live_terminal.kill_requested,
            live_terminal.timed_out
        ),
        (live_life.pid, Some(0), true, false, false)
    );
    physical::assert_reaped(&foreign_life);
    physical::assert_reaped(&live_life);
    capture_preclose_case(
        "unused-foreign",
        &json!({"foreign":{"pid":foreign_life.pid,"birth":foreign_life.birth,"executable":foreign_life.executable},"live":{"pid":live_life.pid,"birth":live_life.birth,"executable":live_life.executable},"originalErrors":original_errors,"preclose":epoch.receipt(),"retired":retired.receipt,"liveTerminal":crate::lsp_client::retirement::observation_json(&live_observer.snapshot())}),
    );
}

#[test]
#[cfg(target_os = "linux")]
#[ignore = "requires the actual pinned native provider and physical Linux custody"]
fn native_preclose_alive_then_killed_stays_strict_across_failed_close_retry() {
    use serde_json::json;
    use std::os::unix::process::ExitStatusExt;
    if !physical::enabled() {
        return;
    }
    let (_root, bridge, life, editor, observer) = native_owner();
    assert!(bridge.freeze_exit_admission());
    assert!(futures::executor::block_on(bridge.preexisting_exit_epoch()).is_none());
    kill_before_close(&life);
    let original_errors = retain_real_rpc_failure(&editor, &observer);
    let first = futures::executor::block_on(bridge.shutdown_for_exit()).unwrap_err();
    let after_first = observer.snapshot();
    assert!(after_first.custody_complete());
    assert_eq!(
        after_first.raw_errors.get(..original_errors.len()),
        Some(original_errors.as_slice())
    );
    let terminal = after_first.terminal.as_ref().unwrap();
    assert_eq!(
        (
            terminal.pid,
            terminal.status.signal(),
            terminal.reaped,
            terminal.kill_requested,
            terminal.timed_out
        ),
        (life.pid, Some(9), true, false, false)
    );
    assert!(futures::executor::block_on(bridge.preexisting_exit_epoch()).is_none());
    let retry = futures::executor::block_on(bridge.shutdown_for_exit()).unwrap_err();
    assert_eq!(
        crate::lsp_client::retirement::observation_json(&observer.snapshot()),
        crate::lsp_client::retirement::observation_json(&after_first)
    );
    physical::assert_reaped(&life);
    capture_preclose_case(
        "alive-killed-retry",
        &json!({"pid":life.pid,"birth":life.birth,"executable":life.executable,"originalErrors":original_errors,"firstError":first.to_string(),"retryError":retry.to_string(),"terminal":crate::lsp_client::retirement::observation_json(&after_first)}),
    );
}

fn bridge(timeout_ms: u64) -> CorsaBridge {
    CorsaBridge::with_config(CorsaBridgeConfig {
        timeout_ms,
        ..Default::default()
    })
}

#[test]
fn exit_shutdown_waits_for_unfinished_abandoned_startup_before_acknowledging() {
    let bridge = bridge(1000);
    let (release, held) = mpsc::channel();
    let (entered, started) = mpsc::channel();
    let initialized = Arc::clone(&bridge.initialized);
    let mut startup = Box::pin(
        bridge
            .worker
            .submit_async(Duration::from_secs(5), move |_| {
                entered.send(()).unwrap();
                held.recv().unwrap();
                // This is the actual spawn completion flag written on the owner lane.
                initialized.store(true, Ordering::SeqCst);
            }),
    );
    assert!(startup.as_mut().now_or_never().is_none());
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    drop(startup);
    assert!(!bridge.is_initialized());
    assert!(bridge.is_draining());
    let mut shutdown = Box::pin(bridge.shutdown_for_exit());
    assert!(
        shutdown.as_mut().now_or_never().is_none(),
        "not initialized does not mean no pending owner"
    );
    release.send(()).unwrap();
    assert!(futures::executor::block_on(shutdown).is_ok());
    assert!(
        !bridge.is_initialized(),
        "cleanup entered after startup completed"
    );
    assert!(!bridge.is_draining());
}

#[test]
fn exit_shutdown_deadline_is_an_error_until_queued_cleanup_really_completes() {
    let bridge = bridge(100);
    let (release, held) = mpsc::channel();
    let (entered, started) = mpsc::channel();
    let mut startup = Box::pin(
        bridge
            .worker
            .submit_async(Duration::from_secs(5), move |_| {
                entered.send(()).unwrap();
                held.recv().unwrap();
            }),
    );
    assert!(startup.as_mut().now_or_never().is_none());
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    drop(startup);
    assert!(matches!(
        futures::executor::block_on(bridge.shutdown_for_exit()),
        Err(crate::corsa_bridge::CorsaBridgeError::Timeout)
    ));
    release.send(()).unwrap();
    // A later acknowledged cleanup still traverses the owner queue.
    assert!(futures::executor::block_on(bridge.shutdown_for_exit()).is_ok());
    assert!(!bridge.is_draining());
}

#[test]
fn exit_shutdown_closes_admission_for_already_queued_and_future_startups() {
    let bridge = bridge(1000);
    let (release, held) = mpsc::channel();
    let (entered, started) = mpsc::channel();
    let mut occupied = Box::pin(
        bridge
            .worker
            .submit_async(Duration::from_secs(5), move |_| {
                entered.send(()).unwrap();
                held.recv().unwrap();
            }),
    );
    assert!(occupied.as_mut().now_or_never().is_none());
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    let mut startup = Box::pin(bridge.spawn());
    assert!(startup.as_mut().now_or_never().is_none());
    let mut shutdown = Box::pin(bridge.shutdown_for_exit());
    assert!(shutdown.as_mut().now_or_never().is_none());
    release.send(()).unwrap();
    assert!(futures::executor::block_on(occupied).is_ok());
    assert!(matches!(
        futures::executor::block_on(startup),
        Err(crate::corsa_bridge::CorsaBridgeError::ProcessTerminated)
    ));
    assert!(futures::executor::block_on(shutdown).is_ok());
    assert!(matches!(
        futures::executor::block_on(bridge.spawn()),
        Err(crate::corsa_bridge::CorsaBridgeError::ProcessTerminated)
    ));
}
