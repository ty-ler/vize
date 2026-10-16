//! A rejected dependency edit never replaces a last-good project owner.
use super::*;
use tower_lsp::lsp_types::{FileChangeType, FileEvent};
use vize_l0::cstr;

fn event(path: &Path, typ: FileChangeType) -> FileEvent {
    FileEvent {
        uri: Url::from_file_path(path).unwrap(),
        typ,
    }
}

fn settings(state: &ServerState) -> serde_json::Value {
    serde_json::json!({
        "checker": state.get_type_checker_config(),
        "timeout": state.lsp_request_timeout_ms(),
        "linter": state.get_linter_config(),
        "rules": state.get_linter_rule_options(),
        "dialect": state.get_dialect_config(),
        "vue": state.type_checker_vue_version().as_str(),
        "dependencies": *state.project_contexts.config_dependencies.read(),
    })
}

fn assert_error(result: &config_reload::ProjectConfigChanges, root: &Path, changed: &Path) {
    let root = Url::from_file_path(root).unwrap();
    let changed = Url::from_file_path(changed).unwrap();
    assert_eq!(
        serde_json::to_value(&result.errors).unwrap(),
        serde_json::json!([{
            "type": 1,
            "message": cstr!("Vize could not reload project configuration for {root} after changes to {changed}. Keeping the last good configuration.").as_str(),
        }])
    );
}

#[test]
fn missing_and_invalid_imported_helpers_keep_owner_settings_and_recover_without_source_edit() {
    let (fixture, state, a, b) = tests::fixture();
    let root = fixture.path().join("packages/a");
    let helper = root.join("vue-settings.mjs");
    std::fs::write(
        root.join("vite.config.mjs"),
        "import vue from './vue-settings.mjs'; export default { vue };",
    )
    .unwrap();
    let good = "export default { formatter: { singleQuote: true }, languageServer: { hover: false }, linter: { rules: { 'a11y/alt-text': 'error' } } };";
    std::fs::write(&helper, good).unwrap();
    state.documents.open(
        a.clone(),
        "<template>unsaved</template>".into(),
        7,
        "vue".into(),
    );
    let sibling = state.document_project_state(&b).unwrap();
    let sibling_settings = settings(&sibling);
    let sibling_stamp = sibling.corsa_request_stamp();
    for invalid in [None, Some("export default { broken syntax")] {
        let previous = state.document_project_state(&a).unwrap();
        let before = settings(&previous);
        let features = previous.lsp_features();
        #[cfg(feature = "glyph")]
        let formatter = serde_json::to_value(previous.get_formatter_context()).unwrap();
        let stamp = previous.corsa_request_stamp();
        let routing = state.stable_project_routing_generation();
        let typ = if let Some(invalid) = invalid {
            std::fs::write(&helper, invalid).unwrap();
            FileChangeType::CHANGED
        } else {
            std::fs::remove_file(&helper).unwrap();
            FileChangeType::DELETED
        };
        let rejected_event = event(&helper, typ);
        let unrelated = event(&root.join("src/normal.ts"), FileChangeType::CHANGED);
        let result = state
            .observe_project_config_events_checked(&[rejected_event.clone(), unrelated.clone()]);
        assert_error(&result, &root, &helper);
        assert_eq!(result.documents, vec![(a.clone(), 7)]);
        assert!(Arc::ptr_eq(
            &previous,
            &state.document_project_state(&a).unwrap()
        ));
        assert!(!previous.project_context_retired());
        assert!(stamp.is_current(&previous));
        assert_eq!(state.stable_project_routing_generation(), routing);
        assert_eq!(settings(&previous), before);
        assert_eq!(previous.lsp_features(), features);
        #[cfg(feature = "glyph")]
        assert_eq!(
            serde_json::to_value(previous.get_formatter_context()).unwrap(),
            formatter
        );
        assert_eq!(
            result.accepted_file_events(&previous, &[rejected_event.clone(), unrelated.clone()]),
            vec![unrelated]
        );
        assert!(
            result
                .accepted_file_events(&sibling, &[rejected_event])
                .is_empty()
        );
        assert!(Arc::ptr_eq(
            &sibling,
            &state.document_project_state(&b).unwrap()
        ));
        assert_eq!(settings(&sibling), sibling_settings);
        assert!(sibling_stamp.is_current(&sibling));
        std::fs::write(&helper, good).unwrap();
        let repaired =
            state.observe_project_config_events_checked(&[event(&helper, FileChangeType::CREATED)]);
        assert!(repaired.errors.is_empty());
        let current = state.document_project_state(&a).unwrap();
        assert!(!Arc::ptr_eq(&previous, &current));
        assert!(!stamp.is_current(&previous));
        assert_eq!(settings(&current), before);
        assert_eq!(
            current.documents.text(&a).as_deref(),
            Some("<template>unsaved</template>")
        );
        assert_eq!(current.documents.version(&a), Some(7));
        assert!(Arc::ptr_eq(
            &sibling,
            &state.document_project_state(&b).unwrap()
        ));
    }
}

#[test]
fn inherited_base_failure_is_checked_even_with_explicit_vite_vue_dialect() {
    for explicit_vue in [false, true] {
        let (fixture, state, a, b) = tests::fixture();
        let root = fixture.path().join("packages/a");
        let base = root.join("tsconfig.base.json");
        let good =
            r#"{"compilerOptions":{"strictNullChecks":true},"vueCompilerOptions":{"target":2.7}}"#;
        std::fs::write(&base, good).unwrap();
        std::fs::write(
            root.join("tsconfig.json"),
            r#"{"extends":"./tsconfig.base.json"}"#,
        )
        .unwrap();
        if explicit_vue {
            std::fs::write(
                root.join("vite.config.mjs"),
                "export default { vue: { version: '3' } };",
            )
            .unwrap();
        }
        let sibling = state.document_project_state(&b).unwrap();
        for invalid in [None, Some("{ invalid JSON")] {
            let previous = state.document_project_state(&a).unwrap();
            let before = settings(&previous);
            let stamp = previous.corsa_request_stamp();
            let typ = if let Some(invalid) = invalid {
                std::fs::write(&base, invalid).unwrap();
                FileChangeType::CHANGED
            } else {
                std::fs::remove_file(&base).unwrap();
                FileChangeType::DELETED
            };
            let change = event(&base, typ);
            let result = state.observe_project_config_events_checked(&[change.clone()]);
            assert_error(&result, &root, &base);
            assert!(Arc::ptr_eq(
                &previous,
                &state.document_project_state(&a).unwrap()
            ));
            assert_eq!(settings(&previous), before);
            assert!(stamp.is_current(&previous));
            assert!(
                result
                    .accepted_file_events(&previous, &[change.clone()])
                    .is_empty()
            );
            assert!(result.accepted_file_events(&sibling, &[change]).is_empty());
            std::fs::write(&base, good).unwrap();
            let repaired = state
                .observe_project_config_events_checked(&[event(&base, FileChangeType::CREATED)]);
            assert!(repaired.errors.is_empty());
            let current = state.document_project_state(&a).unwrap();
            assert!(!Arc::ptr_eq(&previous, &current));
            assert_eq!(settings(&current), before);
            assert!(Arc::ptr_eq(
                &sibling,
                &state.document_project_state(&b).unwrap()
            ));
        }
    }
}

#[test]
fn prepared_snapshot_is_used_once_and_remains_watchable_before_lazy_initialization() {
    let (fixture, state, a, _) = tests::fixture();
    let root = fixture.path().join("packages/a");
    let helper = root.join("settings.mjs");
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: false } };",
    )
    .unwrap();
    std::fs::write(
        root.join("vite.config.mjs"),
        "import vue from './settings.mjs'; export default { vue };",
    )
    .unwrap();
    let original = state.document_project_state(&a).unwrap();
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: true } };",
    )
    .unwrap();
    let result =
        state.observe_project_config_events_checked(&[event(&helper, FileChangeType::CHANGED)]);
    assert!(result.errors.is_empty());
    assert!(state.cached_project_states().is_empty());
    // A second event must see the prepared configuration's dependency graph,
    // even before any document initializes that replacement context.
    std::fs::remove_file(&helper).unwrap();
    let rejected =
        state.observe_project_config_events_checked(&[event(&helper, FileChangeType::DELETED)]);
    assert_error(&rejected, &root, &helper);
    let prepared = state.document_project_state(&a).unwrap();
    assert!(
        prepared.lsp_features().hover,
        "no second evaluation of the now-missing helper"
    );
    assert!(!Arc::ptr_eq(&original, &prepared));
    assert!(!prepared.project_context_retired());
}

#[test]
fn deleting_root_vite_config_can_select_defaults() {
    let (fixture, state, a, b) = tests::fixture();
    let root = fixture.path().join("packages/a");
    let previous = state.document_project_state(&a).unwrap();
    let sibling = state.document_project_state(&b).unwrap();
    let config = root.join("vite.config.mjs");
    std::fs::remove_file(&config).unwrap();
    let result =
        state.observe_project_config_events_checked(&[event(&config, FileChangeType::DELETED)]);
    assert!(result.errors.is_empty());
    let current = state.document_project_state(&a).unwrap();
    assert!(!Arc::ptr_eq(&previous, &current));
    assert!(current.lsp_features().hover);
    assert!(Arc::ptr_eq(
        &sibling,
        &state.document_project_state(&b).unwrap()
    ));
}

#[test]
fn config_helper_that_is_also_a_sibling_source_import_still_invalidates_that_importer() {
    let (fixture, state, a, b) = tests::fixture();
    let helper = fixture.path().join("packages/a/shared.mjs");
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: false } };",
    )
    .unwrap();
    std::fs::write(
        fixture.path().join("packages/a/vite.config.mjs"),
        "import vue from './shared.mjs'; export default { vue };",
    )
    .unwrap();
    state.document_project_state(&a).unwrap();
    let sibling = state.document_project_state(&b).unwrap();
    state.documents.open(
        b.clone(),
        "<script setup>import policy from '../../a/shared.mjs'</script>".into(),
        1,
        "vue".into(),
    );
    sibling
        .open_imports
        .update(&b, "import policy from '../../a/shared.mjs';");
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: true } };",
    )
    .unwrap();
    let changed = event(&helper, FileChangeType::CHANGED);
    let result = state.observe_project_config_events_checked(&[changed.clone()]);
    assert!(result.errors.is_empty());
    assert_eq!(
        result.accepted_file_events(&sibling, &[changed.clone()]),
        vec![changed]
    );
}

#[test]
fn newly_introduced_missing_or_malformed_imports_recover_on_creation_or_change() {
    for shared in [false, true] {
        for malformed in [false, true] {
            let (fixture, state, a, b) = tests::fixture();
            let root = fixture.path().join("packages/a");
            let helper = root.join("settings.mjs");
            let (specifier, target) = if shared {
                (
                    "../../shared-settings.mjs",
                    fixture.path().join("shared-settings.mjs"),
                )
            } else {
                ("./next-settings.mjs", root.join("next-settings.mjs"))
            };
            std::fs::write(
                root.join("vite.config.mjs"),
                "import vue from './settings.mjs'; export default { vue };",
            )
            .unwrap();
            std::fs::write(
                &helper,
                "export default { languageServer: { hover: false } };",
            )
            .unwrap();
            let before = state.document_project_state(&a).unwrap();
            let sibling = state.document_project_state(&b).unwrap();
            if malformed {
                std::fs::write(&target, "export default {").unwrap();
            }
            std::fs::write(
                &helper,
                cstr!("export {{ default }} from '{specifier}';").as_bytes(),
            )
            .unwrap();
            let rejected = state
                .observe_project_config_events_checked(&[event(&helper, FileChangeType::CHANGED)]);
            assert_error(&rejected, &root, &helper);
            assert!(Arc::ptr_eq(
                &before,
                &state.document_project_state(&a).unwrap()
            ));
            let unrelated = event(&root.join("src/ordinary.ts"), FileChangeType::CHANGED);
            let retry = state.observe_project_config_events_checked(&[unrelated.clone()]);
            assert!(
                retry.errors.is_empty(),
                "incidental retries do not repeat editor error toasts"
            );
            assert_eq!(
                retry.accepted_file_events(&before, &[unrelated.clone()]),
                vec![unrelated]
            );
            assert!(Arc::ptr_eq(
                &before,
                &state.document_project_state(&a).unwrap()
            ));
            std::fs::write(
                &target,
                "export default { languageServer: { hover: true } };",
            )
            .unwrap();
            let change = event(
                &target,
                if malformed {
                    FileChangeType::CHANGED
                } else {
                    FileChangeType::CREATED
                },
            );
            let repaired = state.observe_project_config_events_checked(&[change.clone()]);
            assert!(repaired.errors.is_empty());
            let current = state.document_project_state(&a).unwrap();
            assert!(!Arc::ptr_eq(&before, &current));
            assert!(current.lsp_features().hover);
            assert!(Arc::ptr_eq(
                &sibling,
                &state.document_project_state(&b).unwrap()
            ));
            assert!(
                repaired
                    .accepted_file_events(&sibling, &[change])
                    .is_empty()
            );
            assert!(
                state
                    .project_contexts
                    .pending_config_reloads
                    .lock()
                    .is_empty()
            );
        }
    }
}

#[test]
fn newly_introduced_missing_or_malformed_inherited_bases_recover_without_config_edit() {
    for shared in [false, true] {
        for malformed in [false, true] {
            let (fixture, state, a, b) = tests::fixture();
            let root = fixture.path().join("packages/a");
            let base = root.join("base.json");
            let (specifier, target) = if shared {
                (
                    "../../shared-options.json",
                    fixture.path().join("shared-options.json"),
                )
            } else {
                ("./next-base.json", root.join("next-base.json"))
            };
            std::fs::write(root.join("tsconfig.json"), r#"{"extends":"./base.json"}"#).unwrap();
            std::fs::write(&base, r#"{"vueCompilerOptions":{"target":2.7}}"#).unwrap();
            let before = state.document_project_state(&a).unwrap();
            let sibling = state.document_project_state(&b).unwrap();
            assert_eq!(
                before.type_checker_vue_version(),
                vize_l0::config::VueVersion::V2_7
            );
            if malformed {
                std::fs::write(&target, "{").unwrap();
            }
            std::fs::write(
                &base,
                serde_json::to_vec(&serde_json::json!({"extends":specifier})).unwrap(),
            )
            .unwrap();
            let rejected = state
                .observe_project_config_events_checked(&[event(&base, FileChangeType::CHANGED)]);
            assert_error(&rejected, &root, &base);
            assert!(Arc::ptr_eq(
                &before,
                &state.document_project_state(&a).unwrap()
            ));
            std::fs::write(&target, r#"{"vueCompilerOptions":{"target":3.5}}"#).unwrap();
            let change = event(
                &target,
                if malformed {
                    FileChangeType::CHANGED
                } else {
                    FileChangeType::CREATED
                },
            );
            let repaired = state.observe_project_config_events_checked(&[change.clone()]);
            assert!(repaired.errors.is_empty());
            let current = state.document_project_state(&a).unwrap();
            assert!(!Arc::ptr_eq(&before, &current));
            assert_eq!(
                current.type_checker_vue_version(),
                vize_l0::config::VueVersion::V3
            );
            assert!(Arc::ptr_eq(
                &sibling,
                &state.document_project_state(&b).unwrap()
            ));
            assert!(
                repaired
                    .accepted_file_events(&sibling, &[change])
                    .is_empty()
            );
            assert!(
                state
                    .project_contexts
                    .pending_config_reloads
                    .lock()
                    .is_empty()
            );
        }
    }
}

#[test]
fn canceled_awaiter_keeps_root_admission_owned_by_the_running_worker() {
    use futures::Future;
    use std::{
        sync::mpsc,
        task::{Context, Poll},
        time::Duration,
    };
    let (_fixture, state, a, _) = tests::fixture();
    let root = state
        .document_context_root(&a.to_file_path().unwrap())
        .unwrap();
    let gates = state.config_reload_gates(&[root]);
    let gate = gates.first().unwrap().clone();
    let admission = futures::executor::block_on(gate.clone().lock_owned());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let mut work = Box::pin(ServerState::project_background(move || {
        let _admission = admission;
        entered_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        done_tx.send(()).unwrap();
    }));
    let mut context = Context::from_waker(futures::task::noop_waker_ref());
    assert!(matches!(work.as_mut().poll(&mut context), Poll::Pending));
    entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    drop(work);
    assert!(
        gate.try_lock().is_none(),
        "canceling the notification must not admit a concurrent owner reload"
    );
    release_tx.send(()).unwrap();
    done_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let _released = futures::executor::block_on(gate.lock());
}

#[test]
fn idle_new_package_markers_do_not_import_or_initialize_that_package() {
    let (fixture, state, a, b) = tests::fixture();
    let current = state.document_project_state(&a).unwrap();
    let idle = fixture.path().join("packages/idle");
    std::fs::create_dir_all(&idle).unwrap();
    std::fs::write(idle.join("package.json"), "{}").unwrap();
    std::fs::write(
        idle.join("vite.config.mjs"),
        "throw new Error('idle configuration must not execute');",
    )
    .unwrap();
    let before = state.stable_project_routing_generation();
    let result = state.observe_project_config_events_checked(&[event(
        &idle.join("package.json"),
        FileChangeType::CREATED,
    )]);
    assert!(result.documents.is_empty());
    assert!(result.errors.is_empty());
    assert_eq!(state.stable_project_routing_generation(), before);
    assert_eq!(state.cached_project_states().len(), 1);
    assert!(Arc::ptr_eq(
        &current,
        &state.document_project_state(&a).unwrap()
    ));
    assert!(!state.project_contexts.contexts.lock().contains_key(&idle));
    assert!(
        !state
            .project_contexts
            .contexts
            .lock()
            .contains_key(&fixture.path().join("packages/b"))
    );
    assert_eq!(state.documents.version(&b), None);
}

#[test]
fn unavailable_worker_retains_known_configuration_events_and_pending_retry() {
    let (fixture, state, a, b) = tests::fixture();
    let root = fixture.path().join("packages/a");
    let helper = root.join("settings.mjs");
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: false } };",
    )
    .unwrap();
    std::fs::write(
        root.join("vite.config.mjs"),
        "import vue from './settings.mjs'; export default { vue };",
    )
    .unwrap();
    let owner = state.document_project_state(&a).unwrap();
    let sibling = state.document_project_state(&b).unwrap();
    let before = settings(&owner);
    let stamp = owner.corsa_request_stamp();
    std::fs::remove_file(&helper).unwrap();
    let changed = event(&helper, FileChangeType::DELETED);
    let ordinary = event(&root.join("src/ordinary.ts"), FileChangeType::CHANGED);
    let failure = state.config_worker_unavailable(&root, &[changed.clone(), ordinary.clone()]);
    assert_eq!(
        serde_json::to_value(&failure.errors).unwrap(),
        serde_json::json!([{
            "type":1,
            "message":"Vize could not reload project configuration because the configuration worker is unavailable. Keeping the last good configuration."
        }])
    );
    assert_eq!(
        failure.accepted_file_events(&owner, &[changed.clone(), ordinary.clone()]),
        vec![ordinary]
    );
    assert!(
        failure
            .accepted_file_events(&sibling, &[changed])
            .is_empty()
    );
    assert!(Arc::ptr_eq(
        &owner,
        &state.document_project_state(&a).unwrap()
    ));
    assert_eq!(settings(&owner), before);
    assert!(stamp.is_current(&owner));
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .contains(&root)
    );
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: true } };",
    )
    .unwrap();
    let repaired =
        state.observe_project_config_events_checked(&[event(&helper, FileChangeType::CREATED)]);
    assert!(repaired.errors.is_empty());
    assert!(
        state
            .document_project_state(&a)
            .unwrap()
            .lsp_features()
            .hover
    );
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .is_empty()
    );
}

#[test]
fn failed_incidental_retry_keeps_shared_tsconfig_included_global_source_events_ordinary() {
    let (fixture, state, a, b) = tests::fixture();
    let root = fixture.path().join("packages/a");
    let helper = root.join("settings.mjs");
    let shared = fixture.path().join("shared-global.ts");
    std::fs::write(&shared, "declare const sharedPolicy: string;").unwrap();
    std::fs::write(
        fixture.path().join("packages/b/tsconfig.json"),
        r#"{"files":["../../shared-global.ts"]}"#,
    )
    .unwrap();
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: false } };",
    )
    .unwrap();
    std::fs::write(
        root.join("vite.config.mjs"),
        "import vue from './settings.mjs'; export default { vue };",
    )
    .unwrap();
    let owner = state.document_project_state(&a).unwrap();
    let sibling = state.document_project_state(&b).unwrap();
    state.documents.open(
        b.clone(),
        "<script setup lang=\"ts\">const value: string = sharedPolicy;</script>".into(),
        1,
        "vue".into(),
    );
    std::fs::remove_file(&helper).unwrap();
    let initial =
        state.observe_project_config_events_checked(&[event(&helper, FileChangeType::DELETED)]);
    assert_error(&initial, &root, &helper);
    std::fs::write(&shared, "declare const sharedPolicy: number;").unwrap();
    let change = event(&shared, FileChangeType::CHANGED);
    assert!(
        crate::server::importers::open_typecheck_dependents(&sibling, &change.uri).is_empty(),
        "the governing global has no ES import edge"
    );
    let retry = state.observe_project_config_events_checked(&[change.clone()]);
    assert!(retry.errors.is_empty());
    assert_eq!(
        retry.accepted_file_events(&owner, &[change.clone()]),
        vec![change.clone()]
    );
    assert_eq!(
        retry.accepted_file_events(&sibling, &[change.clone()]),
        vec![change]
    );
    assert!(Arc::ptr_eq(
        &owner,
        &state.document_project_state(&a).unwrap()
    ));
    assert!(Arc::ptr_eq(
        &sibling,
        &state.document_project_state(&b).unwrap()
    ));
    assert_eq!(
        std::fs::read_to_string(fixture.path().join("packages/b/tsconfig.json")).unwrap(),
        r#"{"files":["../../shared-global.ts"]}"#
    );
}

#[test]
fn queued_or_unavailable_worker_after_workspace_removal_does_not_retain_retry_metadata() {
    let fixture = tempfile::tempdir().unwrap();
    let primary = fixture.path().join("primary");
    let secondary = fixture.path().join("secondary");
    std::fs::create_dir_all(&primary).unwrap();
    std::fs::create_dir_all(&secondary).unwrap();
    let state = Arc::new(ServerState::new());
    state.set_workspace_root(primary.clone());
    state.load_workspace_config(&primary);
    state.set_workspace_folders(vec![primary.clone(), secondary.clone()]);
    state.documents.open(
        Url::from_file_path(secondary.join("App.vue")).unwrap(),
        "<template />".into(),
        1,
        "vue".into(),
    );
    let config = secondary.join("vite.config.mjs");
    std::fs::write(&config, "export default {};").unwrap();
    let changes = vec![event(&config, FileChangeType::CREATED)];
    let queued_scope = state.project_config_event_scope(&changes);
    assert_eq!(queued_scope.affected, vec![secondary.clone()]);
    state.set_workspace_folders(vec![primary]);
    state.refresh_project_routes();
    let unavailable = state.config_worker_unavailable(&secondary, &changes);
    assert!(unavailable.documents.is_empty());
    assert!(unavailable.errors.is_empty());
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .is_empty()
    );
    // This is the exact operation owned by an already queued worker, after
    // the workspace-removal handler has completed its refresh.
    let result = state.apply_project_config_events(&changes, queued_scope);
    assert!(result.documents.is_empty());
    assert!(result.errors.is_empty());
    assert!(state.project_contexts.contexts.lock().is_empty());
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .is_empty()
    );
}
