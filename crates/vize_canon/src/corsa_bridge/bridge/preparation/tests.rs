//! Real preparation yields dispatch and retains the original caller retirement.

use std::sync::{Arc, atomic::Ordering, mpsc};
use std::time::Duration;

use futures::{FutureExt, executor::block_on};

use super::super::{CorsaBridge, CorsaBridgeError};

#[test]
fn a_blocked_real_vue_preparation_yields_and_cancellation_cannot_publish_old_inputs() {
    let storage = tempfile::tempdir().unwrap();
    let host = storage.path().join("Host.vue");
    let source =
        "<script setup lang='ts'>const value = 1;</script><template>{{ value }}</template>";
    std::fs::write(&host, source).unwrap();
    let bridge = Arc::new(CorsaBridge::new());
    let session = Arc::clone(&bridge.editor_session);
    let held = session.cache();
    let (poll_result, observed) = mpsc::channel();
    let owner = Arc::clone(&bridge);
    let request = std::thread::spawn(move || {
        let mut request =
            Box::pin(owner.open_vue_virtual_document(&host, source, Default::default()));
        let yielded = request.as_mut().now_or_never().is_none();
        drop(request);
        poll_result.send(yielded).unwrap();
    });
    // Always release the real preparation lock before asserting so the old
    // synchronous regression also drains rather than hanging the test process.
    let yielded = observed.recv_timeout(Duration::from_secs(1));
    drop(held);
    request.join().unwrap();
    assert!(
        yielded.unwrap_or(false),
        "actual preparation blocked the caller poll"
    );
    block_on(
        bridge
            .worker
            .submit_ready_async(Duration::from_secs(10), |_| ()),
    )
    .unwrap();
    assert!(!bridge.is_draining());
    assert!(
        std::fs::read_dir(session.root().unwrap())
            .unwrap()
            .next()
            .is_none()
    );
}

#[test]
fn preparation_errors_and_native_initialization_errors_keep_their_original_order() {
    let bridge = CorsaBridge::new();
    let error = "actual authored preparation error";
    let result = block_on(bridge.with_prepared_client(
        move || Err::<(), _>(CorsaBridgeError::CommunicationError(error.into())),
        |_, ()| Ok(()),
    ));
    assert!(matches!(result, Err(CorsaBridgeError::CommunicationError(value)) if value == error));
    let result = block_on(bridge.with_prepared_client(|| Ok(()), |_, ()| Ok(())));
    assert!(matches!(result, Err(CorsaBridgeError::NotInitialized)));
    bridge.initialized.store(true, Ordering::SeqCst);
    let result = block_on(bridge.with_prepared_client(|| Ok(()), |_, ()| Ok(())));
    assert!(matches!(result, Err(CorsaBridgeError::ProcessTerminated)));
}

#[test]
fn an_entered_actual_preparation_cannot_publish_after_its_caller_retires() {
    let storage = tempfile::tempdir().unwrap();
    let host = storage.path().join("Host.vue");
    let source =
        "<script setup lang='ts'>const value = 1;</script><template>{{ value }}</template>";
    std::fs::write(&host, source).unwrap();
    let bridge = CorsaBridge::new();
    let session = Arc::clone(&bridge.editor_session);
    let retained = Arc::clone(&session);
    let held = session.cache();
    let (entered, observed) = mpsc::channel();
    let mut request = Box::pin(bridge.with_prepared_client(
        move || {
            entered.send(()).unwrap();
            crate::corsa_bridge::build_vue_virtual_project_with_overlays_and_options_and_package_routes(
                &host,
                source,
                Default::default(),
                &[],
                crate::corsa_bridge::CorsaProjectEnvironment {
                    virtual_ts_options: &Default::default(),
                    package_routes: &Default::default(),
                    project_root: None,
                    tsconfig_path: None,
                    editor_session: &retained,
                },
            )
        },
        |_, _| Ok(()),
    ));
    assert!(request.as_mut().now_or_never().is_none());
    observed.recv_timeout(Duration::from_secs(10)).unwrap();
    drop(request);
    assert!(bridge.is_draining());
    drop(held);
    block_on(
        bridge
            .worker
            .submit_ready_async(Duration::from_secs(10), |_| ()),
    )
    .unwrap();
    assert!(!bridge.is_draining());
    assert!(
        std::fs::read_dir(session.root().unwrap())
            .unwrap()
            .next()
            .is_none()
    );
}

#[test]
fn entered_preparation_keeps_its_deadline_and_drains_after_timeout() {
    let bridge = CorsaBridge::with_config(crate::corsa_bridge::CorsaBridgeConfig {
        timeout_ms: 50,
        ..Default::default()
    });
    let (release, held) = mpsc::channel();
    let (entered, observed) = mpsc::channel();
    let mut request = Box::pin(bridge.with_prepared_client(
        move || {
            entered.send(()).unwrap();
            held.recv_timeout(Duration::from_secs(10)).unwrap();
            Ok(())
        },
        |_, ()| Ok(()),
    ));
    assert!(request.as_mut().now_or_never().is_none());
    observed.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(matches!(block_on(request), Err(CorsaBridgeError::Timeout)));
    assert!(bridge.is_draining());
    release.send(()).unwrap();
    block_on(
        bridge
            .worker
            .submit_ready_async(Duration::from_secs(10), |_| ()),
    )
    .unwrap();
    assert!(!bridge.is_draining());
}
