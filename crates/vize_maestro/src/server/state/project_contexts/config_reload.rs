//! Await root-local admission before consuming a bounded config worker.
use super::paths::physical_path;
use super::{Arc, PathBuf, ServerState, Url};
use tower_lsp::lsp_types::{FileEvent, MessageType, ShowMessageParams};

#[derive(Default)]
pub(crate) struct ProjectConfigChanges {
    pub documents: Vec<(Url, i32)>,
    pub errors: Vec<ShowMessageParams>,
    pub(super) rejected: Vec<(std::path::PathBuf, Vec<Url>)>,
    pub(super) configuration_events: Vec<Url>,
}

impl ProjectConfigChanges {
    /// A rejected dependency must not invalidate the retained native program.
    /// Other events in the same notification still reach this owner.
    pub(crate) fn accepted_file_events(
        &self,
        state: &ServerState,
        changes: &[FileEvent],
    ) -> Vec<FileEvent> {
        let boundary = state
            .project_contexts
            .boundary
            .read()
            .clone()
            .or_else(|| state.get_workspace_root());
        changes
            .iter()
            .filter(|change| {
                if self.rejected.iter().any(|(root, dependencies)| {
                    boundary
                        .as_ref()
                        .is_some_and(|boundary| physical_path(boundary) == physical_path(root))
                        && dependencies.contains(&change.uri)
                }) {
                    return false;
                }
                if !self.configuration_events.contains(&change.uri) {
                    return true;
                }
                // A sibling's config is not a disk mutation of this project. Keep
                // ordinary source imports of that same file observable, including
                // cross-package imports recorded by the open-importer index.
                let own_path = change.uri.to_file_path().is_ok_and(|path| {
                    boundary
                        .as_ref()
                        .is_some_and(|root| physical_path(&path).starts_with(physical_path(root)))
                        || state
                            .project_contexts
                            .config_dependencies
                            .read()
                            .iter()
                            .any(|dependency| physical_path(dependency) == physical_path(&path))
                });
                own_path
                    || !crate::server::importers::open_typecheck_dependents(state, &change.uri)
                        .is_empty()
            })
            .cloned()
            .collect()
    }
}

pub(super) fn reload_error(root: &std::path::Path, changes: &[Url]) -> ShowMessageParams {
    let root = Url::from_file_path(root)
        .map(|root| vize_l0::cstr!("{root}"))
        .unwrap_or_else(|()| vize_l0::cstr!("{}", root.display()));
    let changed = changes
        .iter()
        .map(Url::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    ShowMessageParams {
        typ: MessageType::ERROR,
        message: vize_l0::cstr!("Vize could not reload project configuration for {root} after changes to {changed}. Keeping the last good configuration.").into(),
    }
}

impl ServerState {
    pub(super) fn config_reload_gates(
        &self,
        roots: &[PathBuf],
    ) -> Vec<Arc<futures::lock::Mutex<()>>> {
        let mut admission = self.project_contexts.reload_admission.lock();
        admission.retain(|_, gate| gate.strong_count() != 0);
        roots
            .iter()
            .map(|root| {
                if let Some(gate) = admission.get(root).and_then(std::sync::Weak::upgrade) {
                    return gate;
                }
                let gate = Arc::new(futures::lock::Mutex::new(()));
                admission.insert(root.clone(), Arc::downgrade(&gate));
                gate
            })
            .collect()
    }

    pub(crate) async fn observe_project_config_events_async(
        self: &Arc<Self>,
        changes: Vec<FileEvent>,
    ) -> ProjectConfigChanges {
        let roots = self.project_config_event_scope(&changes).affected;
        let results = futures::future::join_all(roots.into_iter().map(|root| {
            let changes = &changes;
            async move {
                let gates = self.config_reload_gates(std::slice::from_ref(&root));
                let Some(gate) = gates.first() else {
                    return ProjectConfigChanges::default();
                };
                let admission = gate.clone().lock_owned().await;
                let mut fresh = self.project_config_event_scope(changes);
                if !fresh.affected.contains(&root) {
                    return ProjectConfigChanges::default();
                }
                fresh.retain_root(root.clone());
                let state = self.clone();
                let worker_changes = changes.clone();
                Self::project_background(move || {
                    // The queued job owns admission even if its requesting
                    // notification is canceled after worker submission.
                    let _admission = admission;
                    state.apply_project_config_events(&worker_changes, fresh)
                })
                .await
                .unwrap_or_else(|| self.config_worker_unavailable(&root, changes))
            }
        }))
        .await;
        let mut result = ProjectConfigChanges::default();
        for next in results {
            result.documents.extend(next.documents);
            result.errors.extend(next.errors);
            result.rejected.extend(next.rejected);
            result
                .configuration_events
                .extend(next.configuration_events);
        }
        result.documents.sort();
        result.documents.dedup();
        result
    }

    pub(super) fn admits_new_config_root(&self, root: &std::path::Path) -> bool {
        self.is_primary_boundary(root)
            || self
                .workspace_root_paths()
                .iter()
                .any(|workspace| physical_path(root).starts_with(physical_path(workspace)))
    }

    pub(super) fn config_worker_unavailable(
        &self,
        root: &std::path::Path,
        changes: &[FileEvent],
    ) -> ProjectConfigChanges {
        let contexts = self.project_contexts.contexts.lock();
        if self.project_routing_shutting_down()
            || (!contexts.contains_key(root) && !self.admits_new_config_root(root))
        {
            return ProjectConfigChanges::default();
        }
        let dependencies = contexts
            .get(root)
            .map(|context| context.config_dependencies())
            .unwrap_or_else(|| self.project_contexts.config_dependencies.read().clone());
        let roots = self.workspace_root_paths();
        let mut rejected = changes
            .iter()
            .filter(|change| {
                change.uri.to_file_path().is_ok_and(|path| {
                    let path = physical_path(&path);
                    dependencies
                        .iter()
                        .any(|dependency| physical_path(dependency) == path)
                        || (super::is_config_marker(&path)
                            && path.starts_with(physical_path(root))
                            && !super::watched::excluded_config_path(&path, &roots))
                })
            })
            .map(|change| change.uri.clone())
            .collect::<Vec<_>>();
        rejected.sort();
        rejected.dedup();
        self.project_contexts
            .pending_config_reloads
            .lock()
            .insert(root.to_path_buf());
        ProjectConfigChanges {
            errors: vec![ShowMessageParams {
                typ: MessageType::ERROR,
                message: "Vize could not reload project configuration because the configuration worker is unavailable. Keeping the last good configuration.".into(),
            }],
            configuration_events: rejected.clone(),
            rejected: vec![(root.to_path_buf(), rejected)],
            ..Default::default()
        }
    }

    #[cfg(test)]
    pub(crate) fn observe_project_config_events(
        self: &Arc<Self>,
        changes: &[FileEvent],
    ) -> Vec<(Url, i32)> {
        let scope = self.project_config_event_scope(changes);
        let gates = self.config_reload_gates(&scope.affected);
        let _guards = futures::executor::block_on(async {
            let mut guards = Vec::new();
            for gate in &gates {
                guards.push(gate.lock().await);
            }
            guards
        });
        self.observe_project_config_events_checked(changes)
            .documents
    }

    #[cfg(test)]
    pub(crate) fn observe_project_config_events_checked(
        self: &Arc<Self>,
        changes: &[FileEvent],
    ) -> ProjectConfigChanges {
        self.apply_project_config_events(changes, self.project_config_event_scope(changes))
    }
}
