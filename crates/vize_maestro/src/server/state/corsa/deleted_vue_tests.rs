//! Exclusive deletion ownership and original retirement boundaries.
#![expect(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    clippy::unwrap_used,
    reason = "owned native bridge lifecycle controls"
)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use vize_canon::{CorsaBridge, CorsaBridgeConfig};
use vize_carton::corsa_resolver::{CorsaResolveRequest, resolve_corsa_executable};

use super::super::ServerState;

#[test]
fn deleted_vue_bridge_retains_only_an_idle_exclusive_native_owner() {
    if std::env::var_os("VIZE_TEST_DISABLE_TSGO").is_some() {
        return;
    }
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap();
    let explicit = std::env::var_os("VIZE_TEST_TSGO_PATH").map(PathBuf::from);
    let runtime = resolve_corsa_executable(CorsaResolveRequest {
        explicit_path: explicit.as_deref(),
        project_root: Some(workspace),
    });
    assert!(runtime.is_ok() || std::env::var_os("VIZE_TEST_REQUIRE_TSGO").is_none());
    let Ok(runtime) = runtime else { return };
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("tsconfig.json"),
        "{\"compilerOptions\":{\"strict\":true}}\n",
    )
    .unwrap();
    let state = ServerState::new();
    state.set_workspace_root(root.path().to_owned());
    let bridge = Arc::new(CorsaBridge::with_config(CorsaBridgeConfig {
        corsa_path: Some(runtime),
        working_dir: Some(root.path().to_owned()),
        ..Default::default()
    }));
    futures::executor::block_on(bridge.spawn()).unwrap();
    assert!(bridge.is_initialized());
    assert!(!bridge.is_draining());
    let identity = Arc::as_ptr(&bridge);
    *state.corsa_bridge.write() = Some(bridge);
    let previous = state.corsa_request_stamp();
    assert!(previous.is_current(&state));
    let deleted = [root.path().join("Child.vue")];
    state.invalidate_corsa_bridge_for_deleted_vue_files(&deleted);
    assert_eq!(
        Arc::as_ptr(state.corsa_bridge.read().as_ref().unwrap()),
        identity
    );
    assert!(
        !previous.is_current(&state),
        "an old native result must be refused"
    );
    state.invalidate_corsa_bridge_for_deleted_vue_files(&deleted);
    assert_eq!(
        Arc::as_ptr(state.corsa_bridge.read().as_ref().unwrap()),
        identity
    );

    // A real initialized borrower keeps its old lane; deletion must isolate it.
    let borrower = state.corsa_bridge.read().clone().unwrap();
    let before_shared_delete = state.corsa_request_stamp();
    assert!(before_shared_delete.is_current(&state));
    state.invalidate_corsa_bridge_for_deleted_vue_files(&deleted);
    assert!(state.corsa_bridge.read().is_none());
    assert!(borrower.is_initialized());
    assert!(!before_shared_delete.is_current(&state));
    futures::executor::block_on(borrower.shutdown()).unwrap();
    assert!(!borrower.is_initialized());
}

#[test]
fn deleted_vue_bridge_retires_pending_and_preserves_configuration_namespace_retirement() {
    let root = tempfile::tempdir().unwrap();
    let state = ServerState::new();
    state.set_workspace_root(root.path().to_owned());
    let pending = Arc::new(CorsaBridge::new());
    *state.corsa_bridge.write() = Some(pending);
    state.invalidate_corsa_bridge_for_deleted_vue_files(&[root.path().join("Child.vue")]);
    assert!(state.corsa_bridge.read().is_none());
    *state.corsa_bridge.write() = Some(Arc::new(CorsaBridge::new()));
    let replacement = tempfile::tempdir().unwrap();
    state.set_workspace_root(replacement.path().to_owned());
    assert!(state.corsa_bridge.read().is_none());
    assert_eq!(
        state.get_workspace_root().as_deref(),
        Some(replacement.path())
    );
}
