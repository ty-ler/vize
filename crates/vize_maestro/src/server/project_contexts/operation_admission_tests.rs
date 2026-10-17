//! A real didChange owns one checked attempt per governing root, including fan-out.
use super::super::MaestroServer;
use futures::{FutureExt, StreamExt};
use serde_json::{Value, json};
use tower_lsp::lsp_types::{
    DidChangeTextDocumentParams, TextDocumentContentChangeEvent, Url,
    VersionedTextDocumentIdentifier,
};
use tower_lsp::{LanguageServer, LspService};

#[test]
fn incomplete_config_failure_evaluates_once_for_did_change_and_two_same_root_importers() {
    let dir = tempfile::tempdir().unwrap();
    let root = vize_carton::path::canonicalize_non_verbatim(dir.path());
    let counter = root.join("count.txt");
    std::fs::write(&counter, "").unwrap();
    let config = root.join("vite.config.mjs");
    std::fs::write(&config, "import {appendFileSync} from 'node:fs'; export default () => { appendFileSync(new URL('./count.txt',import.meta.url),'x'); return {vue:{}}; };").unwrap();
    let (service, mut socket) = LspService::new(|client| {
        let mut server = MaestroServer::new(client);
        server.initial_diagnostics = None;
        server.configuration_watchers = None;
        server
    });
    let server = service.inner();
    server.state.set_workspace_root(root.clone());
    server.state.load_workspace_config(&root);
    server.state.apply_lsp_initialization_options(Some(
        &json!({"lint":true,"typecheck":false,"ecosystem":false}),
    ));
    let leaf = Url::from_file_path(root.join("Leaf.vue")).unwrap();
    let importers =
        ["Alpha.vue", "Beta.vue"].map(|name| Url::from_file_path(root.join(name)).unwrap());
    let leaf_source = "<template><div>before</div></template>";
    for (uri, source) in std::iter::once((&leaf, leaf_source)).chain(importers.iter().map(|uri| (uri, "<script setup lang=\"ts\">import Leaf from './Leaf.vue'</script><template><Leaf /></template>"))) {
        std::fs::write(uri.to_file_path().unwrap(), source).unwrap();
        server.state.documents.open(uri.clone(), source.into(), 1, "vue".into());
        let project = crate::runtime::block_on(server.for_document(uri));
        project.state.update_virtual_docs(uri, source);
    }
    assert_eq!(std::fs::read_to_string(&counter).unwrap(), "xx");
    std::fs::write(&config, "import {appendFileSync} from 'node:fs'; export default async () => { appendFileSync(new URL('./count.txt',import.meta.url),'x'); await import('never-installed-editor-plugin'); return {vue:{}}; };").unwrap();
    let changed = "<template><div>after</div></template>";
    let messages = crate::runtime::block_on(async {
        let operation = server
            .did_change(DidChangeTextDocumentParams {
                text_document: VersionedTextDocumentIdentifier {
                    uri: leaf.clone(),
                    version: 2,
                },
                content_changes: vec![TextDocumentContentChangeEvent {
                    range: None,
                    range_length: None,
                    text: changed.into(),
                }],
            })
            .fuse();
        futures::pin_mut!(operation);
        let mut messages = Vec::<Value>::new();
        loop {
            futures::select! {
                () = operation => break,
                message = socket.next().fuse() => messages.push(serde_json::to_value(message.unwrap()).unwrap()),
            }
        }
        while let Some(Some(message)) = socket.next().now_or_never() {
            messages.push(serde_json::to_value(message).unwrap());
        }
        messages
    });
    assert_eq!(std::fs::read_to_string(&counter).unwrap(), "xxx");
    assert_eq!(server.state.documents.text(&leaf).as_deref(), Some(changed));
    assert_eq!(server.state.documents.version(&leaf), Some(2));
    let root_uri = Url::from_file_path(&root).unwrap();
    let config_uri = Url::from_file_path(&config).unwrap();
    let mut expected = vec![
        json!({"jsonrpc":"2.0","method":"window/showMessage","params":{"type":1,"message":format!("Vize could not reload project configuration for {root_uri} after changes to {config_uri}. Keeping the last good configuration.")}}),
    ];
    for (uri, version) in std::iter::once((&leaf, 2)).chain(importers.iter().map(|uri| (uri, 1))) {
        expected.push(json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":uri,"version":version,"diagnostics":[]}}));
    }
    assert_eq!(messages, expected);
}

#[test]
fn importer_fanout_checks_each_other_root_once_and_applies_its_actual_new_policy() {
    let dir = tempfile::tempdir().unwrap();
    let root = vize_carton::path::canonicalize_non_verbatim(dir.path());
    let a = root.join("a");
    let b = root.join("b");
    for package in [&a, &b] {
        std::fs::create_dir_all(package).unwrap();
        std::fs::write(package.join("package.json"), "{}").unwrap();
        std::fs::write(package.join("count.txt"), "").unwrap();
        std::fs::write(package.join("vite.config.mjs"), "import {appendFileSync} from 'node:fs'; export default () => { appendFileSync(new URL('./count.txt',import.meta.url),'x'); return {vue:{languageServer:{hover:false}}}; };").unwrap();
    }
    let (service, mut socket) = LspService::new(|client| {
        let mut server = MaestroServer::new(client);
        server.initial_diagnostics = None;
        server.configuration_watchers = None;
        server
    });
    let server = service.inner();
    server.state.set_workspace_root(root.clone());
    server.state.set_workspace_folders(vec![root.clone()]);
    server.state.load_workspace_config(&root);
    server.state.apply_lsp_initialization_options(Some(
        &json!({"lint":true,"typecheck":false,"ecosystem":false}),
    ));
    let leaf = Url::from_file_path(a.join("Leaf.vue")).unwrap();
    let importers = [&a, &b]
        .into_iter()
        .flat_map(|package| {
            ["Alpha.vue", "Beta.vue"].map(|name| Url::from_file_path(package.join(name)).unwrap())
        })
        .collect::<Vec<_>>();
    for uri in std::iter::once(&leaf).chain(importers.iter()) {
        let source = if uri == &leaf {
            "<template><div>before</div></template>"
        } else if uri.to_file_path().unwrap().starts_with(&a) {
            "<script setup lang=\"ts\">import Leaf from './Leaf.vue'</script><template><Leaf /></template>"
        } else {
            "<script setup lang=\"ts\">import Leaf from '../a/Leaf.vue'</script><template><Leaf /></template>"
        };
        std::fs::write(uri.to_file_path().unwrap(), source).unwrap();
        server
            .state
            .documents
            .open(uri.clone(), source.into(), 1, "vue".into());
        let project = crate::runtime::block_on(server.for_document(uri));
        project.state.update_virtual_docs(uri, source);
    }
    for package in [&a, &b] {
        assert_eq!(
            std::fs::read_to_string(package.join("count.txt")).unwrap(),
            "xx"
        );
    }
    std::fs::write(a.join("vite.config.mjs"), "import {appendFileSync} from 'node:fs'; export default async () => { appendFileSync(new URL('./count.txt',import.meta.url),'x'); await import('never-installed-editor-plugin'); return {vue:{}}; };").unwrap();
    std::fs::write(b.join("vite.config.mjs"), "import {appendFileSync} from 'node:fs'; export default () => { appendFileSync(new URL('./count.txt',import.meta.url),'x'); return {vue:{languageServer:{hover:true}}}; };").unwrap();
    let changed = "<template><div>after</div></template>";
    let messages = crate::runtime::block_on(async {
        let operation = server
            .did_change(DidChangeTextDocumentParams {
                text_document: VersionedTextDocumentIdentifier {
                    uri: leaf.clone(),
                    version: 2,
                },
                content_changes: vec![TextDocumentContentChangeEvent {
                    range: None,
                    range_length: None,
                    text: changed.into(),
                }],
            })
            .fuse();
        futures::pin_mut!(operation);
        let mut messages = Vec::<Value>::new();
        loop {
            futures::select! {
                () = operation => break,
                message = socket.next().fuse() => messages.push(serde_json::to_value(message.unwrap()).unwrap()),
            }
        }
        while let Some(Some(message)) = socket.next().now_or_never() {
            messages.push(serde_json::to_value(message).unwrap());
        }
        messages
    });
    for package in [&a, &b] {
        assert_eq!(
            std::fs::read_to_string(package.join("count.txt")).unwrap(),
            "xxx"
        );
    }
    for uri in importers
        .iter()
        .filter(|uri| uri.to_file_path().unwrap().starts_with(&b))
    {
        assert!(
            server
                .state
                .document_project_state(uri)
                .unwrap()
                .lsp_features()
                .hover
        );
    }
    let root_uri = Url::from_file_path(&a).unwrap();
    let config_uri = Url::from_file_path(a.join("vite.config.mjs")).unwrap();
    let mut expected = vec![
        json!({"jsonrpc":"2.0","method":"window/showMessage","params":{"type":1,"message":format!("Vize could not reload project configuration for {root_uri} after changes to {config_uri}. Keeping the last good configuration.")}}),
    ];
    for (uri, version) in std::iter::once((&leaf, 2)).chain(importers.iter().map(|uri| (uri, 1))) {
        expected.push(json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":uri,"version":version,"diagnostics":[]}}));
    }
    assert_eq!(messages, expected);
}
