//! Disk invalidation cannot turn retained unsaved buffers into disk answers.

use super::{CorsaProjectClient, control, fs, only_owner};

#[test]
fn native_editor_resolves_package_alias_from_monorepo_root_replays_unsaved_api_after_disk_events() {
    if !control::enabled() {
        return;
    }
    let fixture = control::fixture();
    let native = control::runtime();
    let root = tempfile::tempdir().unwrap();
    control::write_fixture(root.path(), &fixture);
    let source = fixture["source"].as_str().unwrap();
    let edited = fixture["leafEdit"].as_str().unwrap();
    let uri = crate::file_uri::path_to_file_uri(&root.path().join("source.ts"));
    let sibling = root.path().join("other.ts");
    fs::write(&sibling, edited).unwrap();
    let sibling_uri = crate::file_uri::path_to_file_uri(&sibling);
    let mut client =
        CorsaProjectClient::new_for_editor_workspace(native.to_str(), root.path()).unwrap();
    client.did_change(&uri, edited).unwrap();
    client
        .did_open_batch_fast(&[(&sibling_uri, source)])
        .unwrap();
    assert_eq!(
        api_type(&mut client, root.path(), edited).as_str(),
        "() => number"
    );
    assert_eq!(
        sibling_type(&mut client, &sibling_uri, source).as_str(),
        "() => string"
    );
    let retained = client.document_texts.clone();
    let mut owner = only_owner(root.path(), &native);
    let declaration = root.path().join("ambient.d.ts");
    for change in ["configuration", "declaration"] {
        if change == "configuration" {
            let mut config = fixture["config"].clone();
            config["compilerOptions"]["noUnusedLocals"] = true.into();
            fs::write(
                root.path().join("tsconfig.json"),
                serde_json::to_vec(&config).unwrap(),
            )
            .unwrap();
        } else {
            fs::write(
                &declaration,
                "declare const changedDeclaration: unique symbol;\n",
            )
            .unwrap();
        }
        client.invalidate_disk_project_state().unwrap();
        control::assert_reaped(&owner);
        assert!(client.session.is_none());
        assert!(client.editor_lsp.is_none());
        assert_eq!(client.document_texts, retained);
        // No editor request or changed buffer precedes the first API answer.
        // Disk contains the opposite types for both complete retained buffers.
        assert_eq!(
            api_type(&mut client, root.path(), edited).as_str(),
            "() => number"
        );
        assert_eq!(
            sibling_type(&mut client, &sibling_uri, source).as_str(),
            "() => string"
        );
        assert_eq!(client.document_texts, retained);
        assert!(client.project_session_attached_to_editor);
        let replacement = only_owner(root.path(), &native);
        assert_ne!(replacement, owner);
        client
            .did_open_batch_fast(&[(&uri, edited), (&sibling_uri, source)])
            .unwrap();
        assert_eq!(
            api_type(&mut client, root.path(), edited).as_str(),
            "() => number"
        );
        assert_eq!(
            sibling_type(&mut client, &sibling_uri, source).as_str(),
            "() => string"
        );
        assert_eq!(only_owner(root.path(), &native), replacement);
        assert_eq!(
            fs::read(root.path().join("source.ts")).unwrap(),
            source.as_bytes()
        );
        assert_eq!(fs::read(&sibling).unwrap(), edited.as_bytes());
        owner = replacement;
    }
    client.shutdown().unwrap();
    control::assert_reaped(&owner);
    assert_eq!(
        fs::read(root.path().join("source.ts")).unwrap(),
        source.as_bytes()
    );
    assert_eq!(fs::read(&sibling).unwrap(), edited.as_bytes());
}

fn api_type(
    client: &mut CorsaProjectClient,
    root: &std::path::Path,
    source: &str,
) -> vize_l0::String {
    sibling_type(
        client,
        &crate::file_uri::path_to_file_uri(&root.join("source.ts")),
        source,
    )
}

fn sibling_type(client: &mut CorsaProjectClient, uri: &str, source: &str) -> vize_l0::String {
    client.project_session().unwrap();
    let session_uri = client.session_document_uris.get(uri).unwrap().clone();
    let session = client.project_session().unwrap();
    let ty = corsa::runtime::block_on(session.get_type_at_position(
        crate::lsp_client::session::uri_document_identifier(&session_uri),
        source.find("answer").unwrap() as u32,
    ))
    .unwrap()
    .unwrap();
    corsa::runtime::block_on(session.type_to_string(ty.id, None, None))
        .unwrap()
        .into()
}

/// Exercise production preparation before the subsequent diagnostic readiness
/// query. A memberless authored Vue project must retain its owner's attachment
/// intent until Canon replaces it with the complete materialized exports world.
#[test]
#[ignore = "requires native 7.0.2 and installed Vue; Actions qualification only"]
fn actual_memberless_vue_preparation_reattaches_same_editor_owner() {
    use crate::corsa_bridge::{
        CorsaProjectEnvironment, EditorMirrorSession,
        build_vue_virtual_project_with_overlays_and_options_and_package_routes,
    };
    use crate::file_uri::path_to_file_uri;
    use corsa::runtime::block_on;
    use lsp_types::{DocumentDiagnosticReport, DocumentDiagnosticReportResult};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::{os::unix::fs::symlink, path::Path};

    for independent_editor in [false, true] {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let native = control::runtime();
        let version = std::process::Command::new(&native)
            .arg("--version")
            .output()
            .unwrap();
        assert!(version.status.success());
        assert_eq!(version.stdout, b"Version 7.0.2\n");
        assert_eq!(version.stderr, b"");
        let corpus =
            repo.join("tests/_fixtures/differential/lsp/symlink-workspace-staging-original");
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let app = root.join("app");
        let capture =
            std::path::PathBuf::from(std::env::var_os("VIZE_SNAPSHOT_SOURCE_CAPTURE_DIR").unwrap())
                .join("memberless-preparation")
                .join(if independent_editor {
                    "with-editor"
                } else {
                    "without-editor"
                });
        fs::create_dir_all(&capture).unwrap();
        let mut authored = Vec::new();
        for (input, output) in [
            ("package.json", "package.json"),
            ("ui/package.json", "ui/package.json"),
            ("ui/UiButton.vue.txt", "ui/UiButton.vue"),
            ("app/tsconfig.json", "app/tsconfig.json"),
            ("app/App.vue.txt", "app/App.vue"),
            ("app/Other.vue.txt", "app/Other.vue"),
        ] {
            let bytes = fs::read(corpus.join(input)).unwrap();
            let path = root.join(output);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, &bytes).unwrap();
            let retained = capture.join("authored").join(output);
            fs::create_dir_all(retained.parent().unwrap()).unwrap();
            fs::write(retained, &bytes).unwrap();
            authored.push((path, bytes));
        }
        fs::create_dir_all(app.join("node_modules")).unwrap();
        symlink("../../ui", app.join("node_modules/ui")).unwrap();
        let vue = repo
            .join("npm/builder/vite/node_modules/vue")
            .canonicalize()
            .unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        symlink(&vue, root.join("node_modules/vue")).unwrap();
        let mut client =
            CorsaProjectClient::new_for_editor_workspace(native.to_str(), &app).unwrap();
        // parseConfigFile cannot select an existing TS startup member yet. This is
        // a refusal to attach now, not permission to discard the requested owner.
        assert!(client.shared_editor_transport_requested);
        assert!(!client.shared_editor_transport);
        assert!(!client.project_session_attached_to_editor);
        assert!(client.editor_lsp.is_none());
        let initial_owner = super::only_process_owner(&app, &native, b"--api");
        let initial_project = client.project_session().unwrap().project().clone();
        let parsed = block_on(
            client
                .project_session()
                .unwrap()
                .client()
                .parse_config_file(crate::lsp_client::session::uri_document_identifier(
                    path_to_file_uri(&app.join("tsconfig.json")).as_str(),
                )),
        )
        .unwrap();
        assert!(parsed.file_names.is_empty());

        let independent_owner = if independent_editor {
            client.ensure_editor_transport().unwrap();
            assert!(!client.project_session_attached_to_editor);
            assert!(!client.shared_editor_transport);
            Some(control::native_lsp(&app, &native))
        } else {
            None
        };
        let host = app.join("App.vue");
        let text = fs::read_to_string(&host).unwrap();
        let mirror = EditorMirrorSession::new();
        let options = crate::virtual_ts::VirtualTsOptions::default();
        let routes = crate::PackageRouteResolver::default();
        let config = app.join("tsconfig.json");
        let mut project = build_vue_virtual_project_with_overlays_and_options_and_package_routes(
            &host,
            &text,
            Default::default(),
            &[],
            CorsaProjectEnvironment {
                virtual_ts_options: &options,
                package_routes: &routes,
                project_root: Some(&app),
                tsconfig_path: Some(&config),
                editor_session: &mirror,
            },
        )
        .unwrap();
        let materialized_root = project.session_project_root.as_ref().unwrap();
        project
            .host
            .source_catalog
            .extend_native_project_documents(materialized_root, &mut project.documents);
        client
            .synchronize_materialized_project(
                materialized_root,
                project.session_config_path.as_deref(),
                &project.materialized_changes,
            )
            .unwrap();
        control::assert_reaped(&initial_owner);
        if let Some(previous) = &independent_owner {
            control::assert_reaped(previous);
        }
        assert!(client.shared_editor_transport_requested);
        assert!(client.shared_editor_transport);
        assert!(client.project_session_attached_to_editor);
        let owner = only_owner(materialized_root, &native);
        let documents = project
            .documents
            .iter()
            .map(|(uri, text)| (uri.as_str(), text.as_str()))
            .collect::<Vec<_>>();
        client.did_open_batch_fast(&documents).unwrap();
        let uri = &project.host.request_uri;
        // This is the exact production preparation/run route, before an editor
        // query can acknowledge/reload a different program or repair the answer.
        let read = client
            .prepare_initial_diagnostics_read(uri)
            .unwrap()
            .unwrap();
        let prepared_project = client.project_session().unwrap().project().clone();
        let snapshot = client.project_session().unwrap().snapshot_lease();
        let prepared = read
            .run()
            .unwrap()
            .expect("all compiler kinds must complete");
        assert!(client.initial_diagnostics_read_is_current(&read));
        let texts = project
            .documents
            .iter()
            .cloned()
            .collect::<vize_l0::FxHashMap<_, _>>();
        assert_eq!(client.document_texts, texts);
        let DocumentDiagnosticReportResult::Report(DocumentDiagnosticReport::Full(report)) =
            client.diagnostics_via_editor_lsp(uri, &texts).unwrap()
        else {
            panic!("complete acknowledged same-owner pull packet required")
        };
        assert_eq!(only_owner(materialized_root, &native), owner);
        assert!(client.project_session_attached_to_editor);
        let attachment = &client
            .editor_lsp
            .as_ref()
            .unwrap()
            .configured_api
            .as_ref()
            .unwrap()
            .session;
        for (index, (document_uri, generated)) in project.documents.iter().enumerate() {
            fs::write(
                capture.join(vize_l0::cstr!("generated-{index}.ts").as_str()),
                generated.as_bytes(),
            )
            .unwrap();
            fs::write(
                capture.join(vize_l0::cstr!("generated-{index}.uri").as_str()),
                document_uri.as_bytes(),
            )
            .unwrap();
        }
        for (source, name) in [
            (
                project.session_config_path.as_ref().unwrap().clone(),
                "materialized-tsconfig.json",
            ),
            (
                materialized_root.join("node_modules/ui/package.json"),
                "materialized-ui-package.json",
            ),
        ] {
            fs::write(capture.join(name), fs::read(source).unwrap()).unwrap();
        }
        let receipt = json!({
            "runtime":native, "versionStdout":version.stdout, "versionStderr":version.stderr,
            "runtimeSha256Bytes":Sha256::digest(fs::read(&native).unwrap()).to_vec(),
            "installedVue":vue, "requestedSharing":true, "initialAttached":false,
            "initialProject":initial_project, "initialParsed":parsed,
            "initialOwner":{"pid":initial_owner.pid,"birth":initial_owner.birth},
            "independentEditorBeforeReplacement":independent_owner.as_ref().map(|owner| json!({"pid":owner.pid,"birth":owner.birth})),
            "materializedRoot":materialized_root,"attached":true,
            "currentOwner":{"pid":owner.pid,"birth":owner.birth},"attachment":attachment,
            "project":prepared_project,"snapshot":snapshot.handle,
            "prepared":prepared,"nativePull":report.full_document_diagnostic_report.items,
        });
        fs::write(
            capture.join("prepared-vs-native.json"),
            serde_json::to_vec_pretty(&receipt).unwrap(),
        )
        .unwrap();
        assert_eq!(prepared, report.full_document_diagnostic_report.items);
        // Independent original source contract: no unresolved UI package, though
        // genuine generated helper hints remain in the full equality above.
        assert!(
            prepared
                .iter()
                .all(|diagnostic| diagnostic.severity == Some(lsp_types::DiagnosticSeverity::HINT))
        );
        drop(read);
        drop(snapshot);
        client.shutdown().unwrap();
        control::assert_reaped(&owner);
        for (path, bytes) in authored {
            assert_eq!(fs::read(path).unwrap(), bytes);
        }
        assert_eq!(
            fs::read_link(app.join("node_modules/ui")).unwrap(),
            Path::new("../../ui")
        );
        assert!(!root.join("ui/UiButton.vue.ts").exists());
        assert!(!root.join("ui/UiButton.d.vue.ts").exists());
    }
}
