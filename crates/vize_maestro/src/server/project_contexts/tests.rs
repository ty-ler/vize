//! Production document dispatch retains original per-owner navigation workers.
use super::MaestroServer;
use crate::{
    runtime::block_on,
    source_project::{SnapshotRefusal, navigation::NavigationRefusal},
};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
use tower_lsp::{
    LspService,
    lsp_types::{FileChangeType, FileEvent, Location, Position, Url},
};
use vize_l0::cstr;

const INPUT: &str = include_str!(
    "../../../../../tests/_fixtures/differential/lsp/project-navigation-cache-8371.json"
);

struct Fixture {
    root: tempfile::TempDir,
    service: LspService<MaestroServer>,
    input: Value,
    uris: Vec<Url>,
}

fn file(root: &Path, name: &str, source: &str) -> Url {
    let path = root.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, source).unwrap();
    Url::from_file_path(path).unwrap()
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    file(root.path(), "vize.config.json", "{}");
    for package in ["a", "b"] {
        file(root.path(), &cstr!("packages/{package}/package.json"), "{}");
        file(
            root.path(),
            &cstr!("packages/{package}/vize.config.json"),
            "{}",
        );
    }
    let (service, socket) = LspService::new(|client| {
        let mut server = MaestroServer::new(client);
        server.initial_diagnostics = None;
        server
    });
    drop(socket);
    let server = service.inner();
    server.state.set_workspace_root(root.path().to_path_buf());
    server
        .state
        .set_workspace_folders(vec![root.path().to_path_buf()]);
    server.state.load_workspace_config(root.path());
    server.state.apply_lsp_initialization_options(Some(
        &json!({"lint":false,"typecheck":false,"ecosystem":false}),
    ));
    let input: Value = serde_json::from_str(INPUT).unwrap();
    let source = input["source"].as_str().unwrap();
    let uris = ["Root.ts", "packages/a/src/One.ts", "packages/b/src/Two.ts"]
        .map(|name| {
            let uri = file(root.path(), name, source);
            server.state.documents.open(
                uri.clone(),
                source.into(),
                input["version"].as_i64().unwrap() as i32,
                input["languageId"].as_str().unwrap().into(),
            );
            uri
        })
        .to_vec();
    Fixture {
        root,
        service,
        input,
        uris,
    }
}

fn position(fixture: &Fixture) -> Position {
    serde_json::from_value(fixture.input["definitionPosition"].clone()).unwrap()
}

fn definition(fixture: &Fixture, uri: &Url) -> Location {
    Location::new(
        uri.clone(),
        serde_json::from_value(fixture.input["definitionRange"].clone()).unwrap(),
    )
}

fn references(fixture: &Fixture, uri: &Url) -> Vec<Location> {
    fixture.input["referenceRanges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|range| Location::new(uri.clone(), serde_json::from_value(range.clone()).unwrap()))
        .collect()
}

#[test]
fn primary_and_nested_document_dispatch_reuse_actual_owner_and_program_workers() {
    let fixture = fixture();
    let server = fixture.service.inner();
    let primary = server.with_project_state(server.state.clone());
    assert!(Arc::ptr_eq(
        server.navigation.as_ref().unwrap(),
        primary.navigation.as_ref().unwrap()
    ));
    let mut worker_ids = Vec::new();
    let mut ordinary_missing = server.with_project_state(server.state.clone());
    ordinary_missing.navigation = None;
    assert_eq!(
        ordinary_missing
            .native_navigation_project()
            .err()
            .unwrap()
            .code,
        tower_lsp::jsonrpc::ErrorCode::InternalError
    );
    for uri in &fixture.uris {
        let first = block_on(server.for_document(uri));
        let navigation = first.navigation.as_ref().unwrap();
        assert_eq!(
            block_on(navigation.definition(uri, position(&fixture))),
            Ok(Some(definition(&fixture, uri)))
        );
        let worker = navigation.cached_program_worker_for_test(uri).unwrap();
        assert_eq!(worker.1, (1, 1));
        let second = block_on(server.for_document(uri));
        assert!(Arc::ptr_eq(&first.state, &second.state));
        assert!(Arc::ptr_eq(navigation, second.navigation.as_ref().unwrap()));
        assert_eq!(
            block_on(
                second
                    .navigation
                    .as_ref()
                    .unwrap()
                    .references(uri, position(&fixture), true)
            ),
            Ok(references(&fixture, uri))
        );
        assert_eq!(
            navigation.cached_program_worker_for_test(uri),
            Some((worker.0, (1, 2)))
        );
        worker_ids.push(worker.0);
    }
    assert_eq!(server.state.cached_project_states().len(), 2);
    let a = block_on(server.for_document(&fixture.uris[1]));
    let b = block_on(server.for_document(&fixture.uris[2]));
    assert!(!Arc::ptr_eq(&a.state, &b.state));
    assert!(!Arc::ptr_eq(
        a.navigation.as_ref().unwrap(),
        b.navigation.as_ref().unwrap()
    ));
    assert!(
        worker_ids
            .iter()
            .enumerate()
            .all(|(index, worker)| !worker_ids[index + 1..].contains(worker))
    );
}

#[test]
fn watcher_retires_old_navigation_and_preserves_the_unaffected_owner_cache() {
    let fixture = fixture();
    let server = fixture.service.inner();
    let a = &fixture.uris[1];
    let b = &fixture.uris[2];
    let old_a = block_on(server.for_document(a));
    let sibling = block_on(server.for_document(b));
    let old_navigation = old_a.navigation.as_ref().unwrap();
    old_a
        .state
        .apply_lsp_initialization_options(Some(&json!({"nativeLinkedEditing":true,"rename":true})));
    let crate::server::NativeLinkedNamesRoute::Native(ticket) =
        old_a.state.capture_native_linked_route()
    else {
        panic!("actual native linked route required")
    };
    let sibling_navigation = sibling.navigation.as_ref().unwrap();
    assert_eq!(
        block_on(old_navigation.definition(a, position(&fixture))),
        Ok(Some(definition(&fixture, a)))
    );
    assert_eq!(
        block_on(sibling_navigation.definition(b, position(&fixture))),
        Ok(Some(definition(&fixture, b)))
    );
    let sibling_worker = sibling_navigation
        .cached_program_worker_for_test(b)
        .unwrap();
    let config = file(
        fixture.root.path(),
        "packages/a/vize.config.json",
        r#"{"lsp":{"hover":false}}"#,
    );
    server.state.observe_project_config_events(&[FileEvent {
        uri: config,
        typ: FileChangeType::CHANGED,
    }]);
    assert!(old_a.state.project_context_retired());
    assert!(old_a.state.cached_project_navigation().is_none());
    let stale_view = server.with_project_state(old_a.state.clone());
    assert!(stale_view.navigation.is_none());
    assert_eq!(
        stale_view.native_navigation_project().err().unwrap().code,
        tower_lsp::jsonrpc::ErrorCode::ContentModified
    );
    let linked = serde_json::from_value(
        json!({"textDocument":{"uri":a},"position":fixture.input["definitionPosition"]}),
    )
    .unwrap();
    assert_eq!(
        block_on(stale_view.native_linked_editing(linked, ticket))
            .unwrap_err()
            .code,
        tower_lsp::jsonrpc::ErrorCode::ContentModified
    );
    assert_eq!(
        block_on(old_navigation.definition(a, position(&fixture))),
        Err(NavigationRefusal::Host(SnapshotRefusal::Superseded))
    );
    assert!(old_navigation.cached_program_worker_for_test(a).is_none());
    let new_a = block_on(server.for_document(a));
    let params = serde_json::from_value(
        json!({"textDocument":{"uri":a},"position":fixture.input["definitionPosition"]}),
    )
    .unwrap();
    let rerouted = block_on(stale_view.for_pos(&params));
    assert!(Arc::ptr_eq(&new_a.state, &rerouted.state));
    assert!(Arc::ptr_eq(
        new_a.navigation.as_ref().unwrap(),
        rerouted.navigation.as_ref().unwrap()
    ));
    let new_b = block_on(server.for_document(b));
    assert!(!Arc::ptr_eq(
        old_navigation,
        new_a.navigation.as_ref().unwrap()
    ));
    assert!(Arc::ptr_eq(
        sibling_navigation,
        new_b.navigation.as_ref().unwrap()
    ));
    assert_eq!(
        block_on(
            new_a
                .navigation
                .as_ref()
                .unwrap()
                .definition(a, position(&fixture))
        ),
        Ok(Some(definition(&fixture, a)))
    );
    assert_eq!(
        block_on(
            new_b
                .navigation
                .as_ref()
                .unwrap()
                .references(b, position(&fixture), true)
        ),
        Ok(references(&fixture, b))
    );
    assert_eq!(
        sibling_navigation.cached_program_worker_for_test(b),
        Some((sibling_worker.0, (1, 2)))
    );
    assert_eq!(server.state.documents.version(a), Some(1));
}

#[test]
fn primary_configuration_replacement_refuses_retained_owner_and_drains_its_worker() {
    let fixture = fixture();
    let server = fixture.service.inner();
    let uri = &fixture.uris[0];
    let navigation = server.navigation.as_ref().unwrap();
    assert_eq!(
        block_on(navigation.definition(uri, position(&fixture))),
        Ok(Some(definition(&fixture, uri)))
    );
    let config = file(
        fixture.root.path(),
        "vize.config.json",
        r#"{"lsp":{"hover":false}}"#,
    );
    // Marking occurs in the registry; publication/admission refuse immediately,
    // before the ordinary server watcher drains the old primary owner.
    server.state.observe_project_config_events(&[FileEvent {
        uri: config.clone(),
        typ: FileChangeType::CHANGED,
    }]);
    assert_eq!(
        block_on(navigation.definition(uri, position(&fixture))),
        Err(NavigationRefusal::Host(SnapshotRefusal::Superseded))
    );
    block_on(tower_lsp::LanguageServer::did_change_watched_files(
        server,
        tower_lsp::lsp_types::DidChangeWatchedFilesParams {
            changes: vec![FileEvent {
                uri: config,
                typ: FileChangeType::CHANGED,
            }],
        },
    ));
    assert!(navigation.cached_program_worker_for_test(uri).is_none());
    let replacement = block_on(server.for_document(uri));
    assert!(!Arc::ptr_eq(
        navigation,
        replacement.navigation.as_ref().unwrap()
    ));
    assert_eq!(
        block_on(
            replacement
                .navigation
                .as_ref()
                .unwrap()
                .definition(uri, position(&fixture))
        ),
        Ok(Some(definition(&fixture, uri)))
    );
}
