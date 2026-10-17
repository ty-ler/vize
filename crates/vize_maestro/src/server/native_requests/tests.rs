//! Complete stale-result and cancellation laws at the real dispatch boundary.
use futures::{FutureExt, channel::oneshot, executor::block_on};
use serde_json::{Value, json};
use tower_lsp::jsonrpc::Error;
use tower_lsp::lsp_types::{TextDocumentContentChangeEvent, Url};

use super::super::build_lsp_service;

const APP: &str =
    include_str!("../../../../../tests/_fixtures/lsp-corsa-responsiveness-8012/App.vue.txt");
const TOAST: &str =
    include_str!("../../../../../tests/_fixtures/lsp-corsa-responsiveness-8012/useToast.ts");

fn pending_native_reply() -> Value {
    // Include an edit outside the request root: stale responses must be
    // refused whole, rather than keeping only apparently unchanged edits.
    json!({"changes": {
        "file:///project/src/App.vue": [{"range":{"start":{"line":3,"character":8},"end":{"line":3,"character":12}},"newText":"notify"}],
        "file:///project/src/useToast.ts": [{"range":{"start":{"line":1,"character":11},"end":{"line":1,"character":15}},"newText":"notify"}]
    }})
}

#[test]
fn root_and_dependency_edits_reject_the_complete_native_response() {
    for changed_uri in [
        "file:///project/src/App.vue",
        "file:///project/src/useToast.ts",
    ] {
        let (service, _socket) = build_lsp_service();
        let server = service.inner();
        let root = Url::parse("file:///project/src/App.vue").unwrap();
        let dependency = Url::parse("file:///project/src/useToast.ts").unwrap();
        server
            .state
            .documents
            .open(root.clone(), APP.into(), 1, "vue".into());
        server
            .state
            .documents
            .open(dependency.clone(), TOAST.into(), 1, "typescript".into());
        let (release, held) = oneshot::channel();
        let mut reply = Box::pin(server.native_request(async {
            held.await.unwrap();
            Ok(pending_native_reply())
        }));
        assert!(reply.as_mut().now_or_never().is_none());
        let changed = Url::parse(changed_uri).unwrap();
        server.state.documents.apply_changes(
            &changed,
            vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "export const replacement = 1;".into(),
            }],
            2,
        );
        release.send(()).unwrap();
        assert_eq!(block_on(reply), Err(Error::content_modified()));
    }
}

#[test]
fn same_version_close_reopen_and_restored_content_do_not_authorize_old_edits() {
    let (service, _socket) = build_lsp_service();
    let server = service.inner();
    let uri = Url::parse("file:///project/src/useToast.ts").unwrap();
    server
        .state
        .documents
        .open(uri.clone(), TOAST.into(), 1, "typescript".into());
    let (release, held) = oneshot::channel();
    let mut reply = Box::pin(server.native_request(async {
        held.await.unwrap();
        Ok(pending_native_reply())
    }));
    assert!(reply.as_mut().now_or_never().is_none());
    server.state.documents.close(&uri);
    server
        .state
        .documents
        .open(uri, TOAST.into(), 1, "typescript".into());
    release.send(()).unwrap();
    assert_eq!(block_on(reply), Err(Error::content_modified()));
}

#[test]
fn disk_config_and_workspace_changes_refuse_pending_native_results() {
    for change in 0..3 {
        let (service, _socket) = build_lsp_service();
        let server = service.inner();
        let (release, held) = oneshot::channel();
        let mut reply = Box::pin(server.native_request(async {
            held.await.unwrap();
            Ok(pending_native_reply())
        }));
        assert!(reply.as_mut().now_or_never().is_none());
        match change {
            0 => server.state.mark_corsa_disk_state_dirty(),
            1 => server
                .state
                .apply_lsp_initialization_options(Some(&json!({"typecheck":false}))),
            _ => server
                .state
                .set_workspace_root(std::path::PathBuf::from("/replacement")),
        }
        release.send(()).unwrap();
        assert_eq!(block_on(reply), Err(Error::content_modified()));
    }
}

#[test]
fn a_cancelled_waiter_never_opens_sources_and_the_next_transaction_reads_current_text() {
    let (service, _socket) = build_lsp_service();
    let server = service.inner();
    let uri = Url::parse("file:///project/src/App.vue").unwrap();
    server
        .state
        .documents
        .open(uri.clone(), APP.into(), 1, "vue".into());
    let (release, held) = oneshot::channel();
    let mut first = Box::pin(server.native_request(async {
        held.await.unwrap();
        Ok(pending_native_reply())
    }));
    assert!(first.as_mut().now_or_never().is_none());
    let entered = std::sync::atomic::AtomicBool::new(false);
    let mut waiting = Box::pin(server.native_request(async {
        entered.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(pending_native_reply())
    }));
    assert!(waiting.as_mut().now_or_never().is_none());
    drop(waiting);
    server.state.documents.apply_changes(
        &uri,
        vec![TextDocumentContentChangeEvent {
            range: None,
            range_length: None,
            text: "<template>new revision</template>".into(),
        }],
        2,
    );
    release.send(()).unwrap();
    assert_eq!(block_on(first), Err(Error::content_modified()));
    assert!(!entered.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        block_on(server.native_request(async { Ok(server.state.documents.text(&uri)) })),
        Ok(Some("<template>new revision</template>".into()))
    );
}

#[test]
fn unchanged_sources_keep_the_complete_legacy_result() {
    let (service, _socket) = build_lsp_service();
    let server = service.inner();
    assert_eq!(
        block_on(server.native_request(async { Ok(pending_native_reply()) })),
        Ok(pending_native_reply())
    );
}

#[test]
fn ignored_older_versions_and_absent_closes_keep_the_complete_result() {
    let (service, _socket) = build_lsp_service();
    let server = service.inner();
    let uri = Url::parse("file:///project/src/App.vue").unwrap();
    server
        .state
        .documents
        .open(uri.clone(), APP.into(), 2, "vue".into());
    let (release, held) = oneshot::channel();
    let mut reply = Box::pin(server.native_request(async {
        held.await.unwrap();
        Ok(pending_native_reply())
    }));
    assert!(reply.as_mut().now_or_never().is_none());
    assert!(!server.state.documents.apply_changes(
        &uri,
        vec![TextDocumentContentChangeEvent {
            range: None,
            range_length: None,
            text: "ignored old source".into(),
        }],
        1
    ));
    server
        .state
        .documents
        .close(&Url::parse("file:///project/src/absent.vue").unwrap());
    release.send(()).unwrap();
    assert_eq!(block_on(reply), Ok(pending_native_reply()));
}

#[test]
fn authored_revision_precedes_admission_but_valid_policy_reload_remains_usable() {
    for changed in [false, true] {
        for workspace in [false, true] {
            let project = tempfile::tempdir().unwrap();
            let root = vize_carton::path::canonicalize_non_verbatim(project.path());
            let config = root.join("vite.config.mjs");
            std::fs::write(&config, "export default {vue:{languageServer:{hover:false,typecheck:false,lint:false,ecosystem:false}}};").unwrap();
            let (service, _socket) = build_lsp_service();
            let server = service.inner();
            server.state.set_workspace_root(root.clone());
            server.state.load_workspace_config(&root);
            let uri = Url::from_file_path(root.join("App.vue")).unwrap();
            server
                .state
                .documents
                .open(uri.clone(), APP.into(), 1, "vue".into());
            std::fs::write(&config, "import {writeFileSync,existsSync} from 'node:fs'; writeFileSync(new URL('./entered',import.meta.url),''); while(!existsSync(new URL('./release',import.meta.url))) await new Promise(resolve=>setTimeout(resolve,1)); export default {vue:{languageServer:{hover:true,typecheck:false,lint:false,ecosystem:false}}};").unwrap();
            let mut admission = Box::pin(server.for_document(&uri));
            assert!(admission.as_mut().now_or_never().is_none());
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while !root.join("entered").is_file() {
                assert!(
                    std::time::Instant::now() < deadline,
                    "actual config admission did not enter"
                );
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            if changed {
                assert!(server.state.documents.apply_changes(
                    &uri,
                    vec![TextDocumentContentChangeEvent {
                        range: None,
                        range_length: None,
                        text: "<template>new revision</template>".into(),
                    }],
                    2
                ));
            }
            std::fs::write(root.join("release"), "").unwrap();
            let view = block_on(admission);
            assert!(
                view.state.lsp_features().hover,
                "the actual valid replacement is admitted"
            );
            let entered = std::sync::atomic::AtomicBool::new(false);
            let request = || async {
                entered.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(pending_native_reply())
            };
            let result = if workspace {
                block_on(view.workspace_native_request(request))
            } else {
                block_on(view.native_request(request()))
            };
            if changed {
                assert_eq!(result, Err(Error::content_modified()));
                assert!(!entered.load(std::sync::atomic::Ordering::SeqCst));
            } else {
                assert_eq!(result, Ok(pending_native_reply()));
                assert!(entered.load(std::sync::atomic::Ordering::SeqCst));
            }
        }
    }
}
