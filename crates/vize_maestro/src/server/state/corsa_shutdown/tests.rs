use super::super::ServerState;
use std::sync::Arc;
use tower_lsp::lsp_types::Url;
use vize_canon::CorsaBridge;

#[test]
fn failed_close_retry_keeps_the_original_active_epoch_and_first_failure() {
    use std::cell::Cell;
    let owner = ServerState::new();
    let bridge = Arc::new(CorsaBridge::new());
    let probes = Cell::new(0);
    {
        let mut state = owner.corsa_shutdown.try_lock().unwrap();
        futures::executor::block_on(state.classify_once(&bridge, || async {
            probes.set(probes.get() + 1);
            None
        }));
        state.pending.push(Arc::clone(&bridge));
        state.first_failure = Some("original active owner refused shutdown".into());
        futures::executor::block_on(state.classify_once(&bridge, || async {
            panic!("a failed close must never acquire a new predead classification")
        }));
    }
    let error = futures::executor::block_on(owner.shutdown_corsa_project_contexts()).unwrap_err();
    assert_eq!(error.as_str(), "original active owner refused shutdown");
    assert_eq!(probes.get(), 1);
    assert!(owner.corsa_shutdown.try_lock().unwrap().pending.is_empty());
    assert_eq!(
        futures::executor::block_on(owner.shutdown_corsa_project_contexts()).unwrap_err(),
        error,
    );
}

#[test]
fn canceled_preclose_probe_is_active_on_retry_and_another_owner_has_its_own_probe() {
    use super::NativeShutdown;
    use futures::FutureExt;
    let first = Arc::new(CorsaBridge::new());
    let other = Arc::new(CorsaBridge::new());
    let mut state = NativeShutdown::default();
    let mut probe = Box::pin(state.classify_once(&first, futures::future::pending));
    assert!(probe.as_mut().now_or_never().is_none());
    drop(probe);
    futures::executor::block_on(state.classify_once(&first, || async {
        panic!("an undelivered initial proof remains active")
    }));
    futures::executor::block_on(state.classify_once(&other, || async { None }));
    assert_eq!(state.epochs.len(), 2);
    assert!(state.epochs.iter().all(|(_, epoch)| epoch.is_none()));
    assert!(Arc::ptr_eq(&state.epochs[0].0, &first));
    assert!(Arc::ptr_eq(&state.epochs[1].0, &other));
}

#[test]
fn final_shutdown_drains_root_and_package_caches_before_retiring_contexts() {
    let root = tempfile::tempdir().unwrap();
    let package = root.path().join("packages/child");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(root.path().join("tsconfig.json"), "{}").unwrap();
    std::fs::write(package.join("tsconfig.json"), "{}").unwrap();
    let owner = Arc::new(ServerState::new());
    owner.set_workspace_root(root.path().to_path_buf());
    owner.apply_project_path_identity(root.path(), Some(root.path()));
    let uri = Url::from_file_path(package.join("App.vue")).unwrap();
    let child = owner.document_project_state(&uri).unwrap();
    assert!(!Arc::ptr_eq(&owner, &child));
    *owner.corsa_bridge.write() = Some(Arc::new(CorsaBridge::new()));
    *child.corsa_bridge.write() = Some(Arc::new(CorsaBridge::new()));
    assert!(futures::executor::block_on(owner.shutdown_corsa_project_contexts()).is_ok());
    assert!(owner.corsa_bridge.read().is_none());
    assert!(child.corsa_bridge.read().is_none());
    assert!(owner.project_context_retired());
    assert!(child.project_context_retired());
    assert!(owner.cached_project_states().is_empty());
    assert!(owner.document_project_state(&uri).is_none());
    assert!(futures::executor::block_on(owner.get_corsa_bridge()).is_none());
    assert!(futures::executor::block_on(child.get_corsa_bridge()).is_none());
    assert!(futures::executor::block_on(owner.shutdown_corsa_project_contexts()).is_ok());
}

#[test]
fn retry_retains_failed_owner_until_acknowledged_and_preserves_first_failure() {
    let owner = ServerState::new();
    let bridge = Arc::new(CorsaBridge::new());
    let weak = Arc::downgrade(&bridge);
    {
        // Seed the exact retained state left by an earlier deadline failure;
        // the retry below still executes the real bridge owner-queue cleanup.
        let mut state = owner.corsa_shutdown.try_lock().unwrap();
        state.pending.push(bridge);
        state.first_failure = Some("original native shutdown deadline".into());
    }
    assert!(weak.upgrade().is_some());
    let result = futures::executor::block_on(owner.shutdown_corsa_project_contexts());
    assert_eq!(
        result.unwrap_err().as_str(),
        "original native shutdown deadline"
    );
    assert!(owner.corsa_shutdown.try_lock().unwrap().pending.is_empty());
    assert!(
        weak.upgrade().is_none(),
        "retry released the retained bridge only after queue acknowledgment"
    );
    let repeated = futures::executor::block_on(owner.shutdown_corsa_project_contexts());
    assert_eq!(
        repeated.unwrap_err().as_str(),
        "original native shutdown deadline"
    );
}

#[test]
fn final_exit_retains_owner_across_config_callbacks_but_ordinary_retirement_does_not_wait() {
    let ordinary = ServerState::new();
    *ordinary.corsa_bridge.write() = Some(Arc::new(CorsaBridge::new()));
    ordinary.retire_corsa_configuration();
    assert!(ordinary.corsa_bridge.read().is_none());

    let closing = ServerState::new();
    let bridge = Arc::new(CorsaBridge::new());
    *closing.corsa_bridge.write() = Some(Arc::clone(&bridge));
    closing.freeze_corsa_owner_for_exit();
    closing.retire_corsa_configuration();
    closing.retire_corsa_bridge(&bridge);
    assert!(Arc::ptr_eq(
        closing.corsa_bridge.read().as_ref().unwrap(),
        &bridge
    ));
    assert!(futures::executor::block_on(closing.shutdown_corsa_project_contexts()).is_ok());
    assert!(closing.corsa_bridge.read().is_none());
    assert!(matches!(
        futures::executor::block_on(bridge.spawn()),
        Err(vize_canon::CorsaBridgeError::ProcessTerminated)
    ));
}
