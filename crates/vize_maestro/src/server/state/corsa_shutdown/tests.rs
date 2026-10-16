use super::super::ServerState;
use std::sync::Arc;
use tower_lsp::lsp_types::Url;
use vize_canon::CorsaBridge;

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
