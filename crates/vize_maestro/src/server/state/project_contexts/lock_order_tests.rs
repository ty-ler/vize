//! Exercise real routing boundaries while the opposite lock is held.
use super::{Arc, ServerState, Url, registry};
use std::{cell::RefCell, sync::mpsc, time::Duration};
use tower_lsp::lsp_types::{FileChangeType, FileEvent};

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    BeforeContexts,
    BeforeRoutes,
    BeforeConfigInstall,
}

type Hook = (Phase, Box<dyn FnOnce()>);

thread_local! {
    static HOOK: RefCell<Option<Hook>> = const { RefCell::new(None) };
}

fn arrive(phase: Phase) {
    let hook = HOOK.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot
            .as_ref()
            .is_some_and(|(expected, _)| *expected == phase)
        {
            slot.take().map(|(_, hook)| hook)
        } else {
            None
        }
    });
    if let Some(hook) = hook {
        hook();
    }
}

pub(super) fn before_contexts_lock() {
    arrive(Phase::BeforeContexts);
}

pub(super) fn before_route_changes() {
    arrive(Phase::BeforeRoutes);
}

pub(super) fn before_config_install() {
    arrive(Phase::BeforeConfigInstall);
}

fn pause_at(phase: Phase) -> (mpsc::Receiver<()>, mpsc::Sender<()>, impl FnOnce()) {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let install = move || {
        HOOK.with(|slot| {
            *slot.borrow_mut() = Some((
                phase,
                Box::new(move || {
                    entered_tx.send(()).unwrap();
                    resume_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                }),
            ));
        });
    };
    (entered_rx, resume_tx, install)
}

fn fixture() -> (
    tempfile::TempDir,
    Arc<ServerState>,
    Url,
    Arc<registry::ProjectContext>,
) {
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(ServerState::new());
    state.set_workspace_root(root.path().to_path_buf());
    let uri = Url::from_file_path(root.path().join("App.vue")).unwrap();
    let context = Arc::new(registry::ProjectContext::new(root.path().to_path_buf()));
    state
        .project_contexts
        .contexts
        .lock()
        .insert(root.path().to_path_buf(), context.clone());
    state
        .project_contexts
        .routes
        .insert(uri.clone(), root.path().to_path_buf());
    (root, state, uri, context)
}

fn marker_corpus() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../../../tests/_fixtures/differential/config/project-marker-retirement.json"
    ))
    .unwrap()
}

#[test]
fn cached_route_releases_its_shard_before_waiting_for_contexts() {
    let (_root, state, uri, expected) = fixture();
    let contexts = state.project_contexts.contexts.lock();
    let (entered, resume, install) = pause_at(Phase::BeforeContexts);
    let worker_state = state.clone();
    let worker_uri = uri.clone();
    let worker = std::thread::spawn(move || {
        install();
        worker_state.document_project_context(&worker_uri).unwrap()
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    let shard_released = matches!(
        state.project_contexts.routes.try_get_mut(&uri),
        dashmap::try_result::TryResult::Present(_)
    );
    drop(contexts);
    resume.send(()).unwrap();
    let actual = worker.join().unwrap();
    assert!(
        shard_released,
        "routing must not wait for contexts with a shard guard"
    );
    assert!(Arc::ptr_eq(&actual, &expected));
}

#[test]
fn config_watcher_releases_contexts_before_waiting_for_a_route_shard() {
    let (root, state, uri, previous) = fixture();
    let route = state.project_contexts.routes.get(&uri).unwrap();
    let generation = state.project_routing_generation();
    let marker = Url::from_file_path(root.path().join("vite.config.mjs")).unwrap();
    let (entered, resume, install) = pause_at(Phase::BeforeRoutes);
    let worker_state = state.clone();
    let worker = std::thread::spawn(move || {
        install();
        worker_state.observe_project_config_events(&[FileEvent {
            uri: marker,
            typ: FileChangeType::CHANGED,
        }])
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    let contexts_released = state.project_contexts.contexts.try_lock().is_some();
    assert!(state.stable_project_routing_generation().is_none());
    drop(route);
    resume.send(()).unwrap();
    assert!(worker.join().unwrap().is_empty());
    assert!(
        contexts_released,
        "watcher must not wait for routes with contexts held"
    );
    assert!(previous.initialize(&state).is_none());
    assert!(state.project_contexts.routes.is_empty());
    assert!(state.stable_project_routing_generation().unwrap() > generation);
}

#[test]
fn generated_and_dependency_markers_do_not_retire_ordinary_nested_owners() {
    let corpus = marker_corpus();
    let (root, state, uri, previous) = fixture();
    let version = corpus["expectedRetainedVersion"].as_i64().unwrap() as i32;
    state.documents.open(
        uri.clone(),
        corpus["openSource"].as_str().unwrap().into(),
        version,
        "vue".into(),
    );
    let generation = state.project_routing_generation();
    let events = corpus["excludedDirectories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|directory| FileEvent {
            uri: Url::from_file_path(
                root.path()
                    .join(directory.as_str().unwrap())
                    .join("nested/package.json"),
            )
            .unwrap(),
            typ: FileChangeType::CHANGED,
        })
        .collect::<Vec<_>>();
    assert!(state.observe_project_config_events(&events).is_empty());
    assert_eq!(state.project_routing_generation(), generation);
    assert!(Arc::ptr_eq(
        &state.document_project_context(&uri).unwrap(),
        &previous
    ));
    let nested = root
        .path()
        .join(corpus["ordinaryNestedMarker"].as_str().unwrap());
    std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
    std::fs::write(&nested, "export default {};").unwrap();
    assert_eq!(
        state.observe_project_config_events(&[FileEvent {
            uri: Url::from_file_path(nested).unwrap(),
            typ: FileChangeType::CREATED,
        }]),
        vec![(uri, version)]
    );
    assert!(previous.initialize(&state).is_none());
    assert!(state.project_routing_generation() > generation);
}

#[cfg(unix)]
#[test]
fn authored_and_physical_dependency_markers_both_refuse_retirement() {
    let (root, state, uri, previous) = fixture();
    let dependency = root.path().join("node_modules/dependency");
    let authored = root.path().join("linked-dependency");
    std::fs::create_dir_all(&dependency).unwrap();
    std::fs::write(dependency.join("package.json"), "{}").unwrap();
    std::os::unix::fs::symlink(&dependency, &authored).unwrap();
    let physical = root.path().join("ordinary-source");
    std::fs::create_dir_all(&physical).unwrap();
    std::fs::write(physical.join("package.json"), "{}").unwrap();
    let ignored = root.path().join("node_modules/linked-source");
    std::os::unix::fs::symlink(&physical, &ignored).unwrap();
    let generation = state.project_routing_generation();
    for marker in [authored.join("package.json"), ignored.join("package.json")] {
        assert!(
            state
                .observe_project_config_events(&[FileEvent {
                    uri: Url::from_file_path(marker).unwrap(),
                    typ: FileChangeType::CHANGED,
                }])
                .is_empty()
        );
    }
    assert_eq!(state.project_routing_generation(), generation);
    assert!(Arc::ptr_eq(
        &state.document_project_context(&uri).unwrap(),
        &previous
    ));
}

#[test]
fn registered_workspaces_named_after_generated_directories_observe_their_own_configuration() {
    let corpus = marker_corpus();
    for name in corpus["acceptedWorkspaceNames"].as_array().unwrap() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join(name.as_str().unwrap());
        std::fs::create_dir_all(&root).unwrap();
        let marker = root.join("vite.config.mjs");
        std::fs::write(&marker, "export default { vue: {} };").unwrap();
        let state = Arc::new(ServerState::new());
        state.set_workspace_root(root.clone());
        let uri = Url::from_file_path(root.join("App.vue")).unwrap();
        state.documents.open(
            uri.clone(),
            "<template>unsaved</template>".into(),
            9,
            "vue".into(),
        );
        let generation = state.project_routing_generation();
        assert_eq!(
            state.observe_project_config_events(&[FileEvent {
                uri: Url::from_file_path(marker).unwrap(),
                typ: FileChangeType::CHANGED,
            }]),
            vec![(uri, 9)]
        );
        assert!(state.project_context_retired());
        assert!(state.project_routing_generation() > generation);
    }
}

#[test]
fn serialized_config_reload_rechecks_latest_disk_after_an_older_preparation() {
    let (root, state, uri, _) = fixture();
    let config = root.path().join("vite.config.mjs");
    let marker = Url::from_file_path(&config).unwrap();
    std::fs::write(
        &config,
        "export default { vue: { languageServer: { hover: false } } };",
    )
    .unwrap();
    let (entered, resume, install) = pause_at(Phase::BeforeConfigInstall);
    let first_state = state.clone();
    let first_marker = marker.clone();
    let first = std::thread::spawn(move || {
        install();
        first_state.observe_project_config_events(&[FileEvent {
            uri: first_marker,
            typ: FileChangeType::CHANGED,
        }])
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    let gates = state.config_reload_gates(&[root.path().to_path_buf()]);
    assert!(
        gates.first().unwrap().try_lock().is_none(),
        "prepared reload retains root admission through installation"
    );
    std::fs::write(
        &config,
        "export default { vue: { languageServer: { hover: true } } };",
    )
    .unwrap();
    let second_state = state.clone();
    let second = std::thread::spawn(move || {
        second_state.observe_project_config_events(&[FileEvent {
            uri: marker,
            typ: FileChangeType::CHANGED,
        }])
    });
    resume.send(()).unwrap();
    first.join().unwrap();
    second.join().unwrap();
    assert!(
        state
            .document_project_state(&uri)
            .unwrap()
            .lsp_features()
            .hover
    );
}

#[test]
fn shutdown_between_preparation_and_installation_never_recreates_primary_owner() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("vite.config.mjs");
    std::fs::write(&config, "export default {};").unwrap();
    let state = Arc::new(ServerState::new());
    state.set_workspace_root(root.path().to_path_buf());
    state.load_workspace_config(root.path());
    assert!(state.project_contexts.contexts.lock().is_empty());
    let (entered, resume, install) = pause_at(Phase::BeforeConfigInstall);
    let worker_state = state.clone();
    let worker = std::thread::spawn(move || {
        install();
        worker_state.observe_project_config_events(&[FileEvent {
            uri: Url::from_file_path(config).unwrap(),
            typ: FileChangeType::CHANGED,
        }])
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    state.retire_project_contexts();
    resume.send(()).unwrap();
    assert!(worker.join().unwrap().is_empty());
    assert!(state.project_contexts.contexts.lock().is_empty());
    assert!(state.cached_project_states().is_empty());
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .is_empty()
    );
    assert!(Arc::ptr_eq(&state, &state.current_primary_project_state()));
}

#[test]
fn same_root_async_waiters_do_not_consume_workers_needed_by_an_unrelated_sibling() {
    use futures::Future;
    use std::task::{Context, Poll};
    let (fixture, state, a, b) = super::tests::fixture();
    state.document_project_state(&a).unwrap();
    let old_b = state.document_project_state(&b).unwrap();
    let root_a = fixture.path().join("packages/a");
    let gates = state.config_reload_gates(&[root_a.clone()]);
    let held = futures::executor::block_on(gates.first().unwrap().lock());
    let changes_a = vec![FileEvent {
        uri: Url::from_file_path(root_a.join("vite.config.mjs")).unwrap(),
        typ: FileChangeType::CHANGED,
    }];
    let mut first = std::pin::pin!(state.observe_project_config_events_async(changes_a.clone()));
    let mut second = std::pin::pin!(state.observe_project_config_events_async(changes_a));
    let mut context = Context::from_waker(futures::task::noop_waker_ref());
    assert!(matches!(first.as_mut().poll(&mut context), Poll::Pending));
    assert!(matches!(second.as_mut().poll(&mut context), Poll::Pending));
    let changes_b = vec![FileEvent {
        uri: Url::from_file_path(fixture.path().join("packages/b/vite.config.mjs")).unwrap(),
        typ: FileChangeType::CHANGED,
    }];
    let (finished_tx, finished_rx) = mpsc::channel();
    let worker_state = state.clone();
    let worker = std::thread::spawn(move || {
        finished_tx
            .send(
                futures::executor::block_on(
                    worker_state.observe_project_config_events_async(changes_b),
                )
                .errors
                .len(),
            )
            .unwrap();
    });
    let finished = finished_rx.recv_timeout(Duration::from_secs(10));
    drop(held);
    assert_eq!(
        finished.unwrap(),
        0,
        "a sibling evaluates while both same-root waiters remain pending"
    );
    worker.join().unwrap();
    assert!(!Arc::ptr_eq(
        &old_b,
        &state.document_project_state(&b).unwrap()
    ));
}

#[test]
fn dependency_event_during_preparation_queues_against_the_new_graph() {
    use futures::Future;
    use std::task::{Context, Poll};
    let (root, state, uri, _) = fixture();
    let helper = root.path().join("settings.mjs");
    let next = root.path().join("next-settings.mjs");
    std::fs::write(
        root.path().join("vite.config.mjs"),
        "import vue from './settings.mjs'; export default { vue };",
    )
    .unwrap();
    std::fs::write(
        &helper,
        "export default { languageServer: { hover: false } };",
    )
    .unwrap();
    let original = state.document_project_state(&uri).unwrap();
    assert!(!original.lsp_features().hover);
    std::fs::write(
        &next,
        "export default { languageServer: { hover: false } };",
    )
    .unwrap();
    std::fs::write(&helper, "export { default } from './next-settings.mjs';").unwrap();
    let (entered, resume, install) = pause_at(Phase::BeforeConfigInstall);
    let first_state = state.clone();
    let first = std::thread::spawn(move || {
        install();
        first_state.observe_project_config_events(&[FileEvent {
            uri: Url::from_file_path(helper).unwrap(),
            typ: FileChangeType::CHANGED,
        }])
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    std::fs::write(&next, "export default { languageServer: { hover: true } };").unwrap();
    let mut newer = Box::pin(state.observe_project_config_events_async(vec![FileEvent {
        uri: Url::from_file_path(next).unwrap(),
        typ: FileChangeType::CHANGED,
    }]));
    let mut context = Context::from_waker(futures::task::noop_waker_ref());
    assert!(
        matches!(newer.as_mut().poll(&mut context), Poll::Pending),
        "the new dependency event must await in-flight root admission rather than return empty against the old graph"
    );
    resume.send(()).unwrap();
    first.join().unwrap();
    assert!(futures::executor::block_on(newer).errors.is_empty());
    let current = state.document_project_state(&uri).unwrap();
    assert!(current.lsp_features().hover);
    assert!(!Arc::ptr_eq(&original, &current));
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .is_empty()
    );
}

#[test]
fn removed_secondary_workspace_cannot_install_a_prepared_new_marker_owner() {
    let fixture = tempfile::tempdir().unwrap();
    let primary = fixture.path().join("primary");
    let secondary = fixture.path().join("secondary");
    std::fs::create_dir_all(&primary).unwrap();
    std::fs::create_dir_all(&secondary).unwrap();
    let state = Arc::new(ServerState::new());
    state.set_workspace_root(primary.clone());
    state.load_workspace_config(&primary);
    state.set_workspace_folders(vec![primary.clone(), secondary.clone()]);
    let uri = Url::from_file_path(secondary.join("App.vue")).unwrap();
    state.documents.open(
        uri,
        "<template>open buffer</template>".into(),
        1,
        "vue".into(),
    );
    assert!(state.project_contexts.contexts.lock().is_empty());
    let config = secondary.join("vite.config.mjs");
    std::fs::write(
        &config,
        "export default { vue: { languageServer: { hover: false } } };",
    )
    .unwrap();
    let (entered, resume, install) = pause_at(Phase::BeforeConfigInstall);
    let worker_state = state.clone();
    let worker = std::thread::spawn(move || {
        install();
        worker_state.observe_project_config_events(&[FileEvent {
            uri: Url::from_file_path(config).unwrap(),
            typ: FileChangeType::CREATED,
        }])
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        state
            .project_contexts
            .pending_config_reloads
            .lock()
            .contains(&secondary)
    );
    state.set_workspace_folders(vec![primary.clone()]);
    state.refresh_project_routes();
    assert!(
        !state
            .project_contexts
            .pending_config_reloads
            .lock()
            .contains(&secondary)
    );
    resume.send(()).unwrap();
    assert!(worker.join().unwrap().is_empty());
    assert!(state.project_contexts.contexts.lock().is_empty());
    assert!(state.cached_project_states().is_empty());
    assert_eq!(state.workspace_root_paths(), vec![primary]);
}
