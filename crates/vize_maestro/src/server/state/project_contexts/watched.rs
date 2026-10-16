//! Retire changed owners and retain open documents needing fresh diagnostics.
use super::{Arc, Ordering, ServerState, Url, is_config_marker, paths::physical_path, registry};
use tower_lsp::lsp_types::FileEvent;

use super::config_reload::{ProjectConfigChanges, reload_error};

pub(super) struct ConfigEventScope {
    pub(super) affected: Vec<std::path::PathBuf>,
    marker_paths: Vec<std::path::PathBuf>,
}

impl ConfigEventScope {
    pub(super) fn retain_root(&mut self, root: std::path::PathBuf) {
        self.marker_paths
            .retain(|path| path.starts_with(physical_path(&root)));
        self.affected = vec![root];
    }
}

impl ServerState {
    pub(super) fn project_config_event_scope(&self, changes: &[FileEvent]) -> ConfigEventScope {
        if self.project_contexts.owner.read().is_some() || self.project_routing_shutting_down() {
            return ConfigEventScope {
                affected: Vec::new(),
                marker_paths: Vec::new(),
            };
        }
        let mut roots = self.workspace_root_paths();
        if let Some(boundary) = self.project_contexts.boundary.read().clone()
            && !roots.contains(&boundary)
        {
            roots.push(boundary);
        }
        let physical_roots = roots
            .iter()
            .map(|root| physical_path(root))
            .collect::<Vec<_>>();
        let changed_paths = changes
            .iter()
            .filter_map(|event| event.uri.to_file_path().ok())
            .map(|path| physical_path(&path))
            .collect::<Vec<_>>();
        let marker_paths = changes
            .iter()
            .filter_map(|event| event.uri.to_file_path().ok())
            .filter(|path| !excluded_config_path(path, &roots))
            .map(|path| physical_path(&path))
            .filter(|path| is_config_marker(path) && !excluded_config_path(path, &physical_roots))
            .collect::<Vec<_>>();
        let config_paths = marker_paths.iter().collect::<Vec<_>>();
        let dependency_changed = |state: &ServerState| {
            state
                .project_contexts
                .config_dependencies
                .read()
                .iter()
                .any(|dependency| changed_paths.contains(&physical_path(dependency)))
        };
        let contexts = self.project_contexts.contexts.lock();
        let mut affected = contexts
            .iter()
            .filter(|(root, context)| {
                context
                    .config_dependencies()
                    .iter()
                    .any(|dependency| changed_paths.contains(&physical_path(dependency)))
                    || config_paths
                        .iter()
                        .any(|path| path.starts_with(physical_path(root)))
            })
            .map(|(root, _)| root.clone())
            .collect::<Vec<_>>();
        if let Some(root) = self
            .project_contexts
            .boundary
            .read()
            .clone()
            .or_else(|| self.get_workspace_root())
            && (dependency_changed(self)
                || config_paths
                    .iter()
                    .any(|path| path.parent() == Some(physical_path(&root).as_path())))
        {
            if !affected.contains(&root) {
                affected.push(root);
            }
        }
        drop(contexts);
        // An unsuccessful evaluation cannot expose its complete graph. Retry
        // pending roots on workspace file events so newly introduced missing
        // or malformed imports recover when created or repaired. No polling.
        if changed_paths.iter().any(|path| {
            !excluded_config_path(path, &physical_roots)
                && physical_roots.iter().any(|root| path.starts_with(root))
        }) {
            affected.extend(
                self.project_contexts
                    .pending_config_reloads
                    .lock()
                    .iter()
                    .cloned(),
            );
        }
        // A newly created marker may introduce an owner which has never
        // existed in the registry; its open documents still need rerouting.
        for path in &marker_paths {
            if let Some(root) = super::paths::document_context_root(path, &roots)
                && !affected
                    .iter()
                    .any(|current| physical_path(current) == physical_path(&root))
                && self.documents.iter().any(|document| {
                    document
                        .key()
                        .to_file_path()
                        .is_ok_and(|path| physical_path(&path).starts_with(physical_path(&root)))
                })
            {
                affected.push(root);
            }
        }
        affected.sort();
        affected.dedup();
        ConfigEventScope {
            affected,
            marker_paths,
        }
    }

    pub(super) fn apply_project_config_events(
        self: &Arc<Self>,
        changes: &[FileEvent],
        scope: ConfigEventScope,
    ) -> ProjectConfigChanges {
        let mut result = ProjectConfigChanges::default();
        if scope.affected.is_empty() || self.project_routing_shutting_down() {
            return result;
        }
        let affected = scope.affected;
        let marker_paths = scope.marker_paths;
        let contexts = self.project_contexts.contexts.lock();
        if self.project_routing_shutting_down() {
            return result;
        }
        // A canonical evaluation can discover a new dependency before its
        // snapshot is installed. File events in that interval must queue this
        // root rather than disappear against the old dependency graph.
        self.project_contexts
            .pending_config_reloads
            .lock()
            .extend(affected.iter().cloned());
        let mut retired = Vec::new();
        // Evaluate outside the registry mutex, once per affected root. The
        // last-good owner remains routable until a complete replacement exists.
        let previous = affected
            .iter()
            .map(|root| (root.clone(), contexts.get(root).cloned()))
            .collect::<Vec<_>>();
        drop(contexts);
        let prepared = previous
            .into_iter()
            .map(|(root, previous)| {
                let dependencies = previous
                    .as_ref()
                    .map(|context| context.config_dependencies())
                    .unwrap_or_else(|| self.project_contexts.config_dependencies.read().clone());
                let mut changed = changes
                    .iter()
                    .filter(|change| {
                        change.uri.to_file_path().is_ok_and(|path| {
                            let path = physical_path(&path);
                            dependencies
                                .iter()
                                .any(|dependency| physical_path(dependency) == path)
                                || (marker_paths.contains(&path)
                                    && path.starts_with(physical_path(&root)))
                        })
                    })
                    .map(|change| change.uri.clone())
                    .collect::<Vec<_>>();
                changed.sort();
                changed.dedup();
                result.configuration_events.extend(changed.clone());
                let direct_change = !changed.is_empty();
                let snapshot = Self::prepare_workspace_config(&root);
                if let Ok(snapshot) = &snapshot {
                    result.configuration_events.extend(
                        changes
                            .iter()
                            .filter(|change| {
                                change.uri.to_file_path().is_ok_and(|path| {
                                    snapshot.project.dependencies.iter().any(|dependency| {
                                        physical_path(dependency) == physical_path(&path)
                                    })
                                })
                            })
                            .map(|change| change.uri.clone()),
                    );
                }
                (root, previous, snapshot, changed, direct_change)
            })
            .collect::<Vec<_>>();
        #[cfg(test)]
        super::lock_order_tests::before_config_install();
        let mut contexts = self.project_contexts.contexts.lock();
        // Shutdown seals admission before draining this same registry lock.
        if self.project_routing_shutting_down() {
            return ProjectConfigChanges::default();
        }
        let mut accepted_primary = false;
        let mut routing_change = None;
        let mut published_roots = Vec::new();
        for (root, previous, snapshot, changed, direct_change) in prepared {
            // Do not replace an owner installed by another concurrent reload.
            let unchanged = match (&previous, contexts.get(&root)) {
                (Some(before), Some(current)) => Arc::ptr_eq(before, current),
                (None, None) => true,
                _ => false,
            };
            if !unchanged {
                continue;
            }
            if previous.is_none() && !self.admits_new_config_root(&root) {
                // A secondary workspace can disappear while a new marker's
                // snapshot is being prepared, with None on both sides of CAS.
                self.project_contexts
                    .pending_config_reloads
                    .lock()
                    .remove(&root);
                continue;
            }
            published_roots.push(root.clone());
            match snapshot {
                Ok(snapshot) => {
                    // Preparation is read-only. Only a successful installation
                    // begins a routing transition shared with global queries.
                    routing_change.get_or_insert_with(|| self.project_routing_change());
                    self.project_contexts
                        .pending_config_reloads
                        .lock()
                        .remove(&root);
                    let replacement = Arc::new(registry::ProjectContext::with_config(
                        root.clone(),
                        snapshot,
                    ));
                    if let Some(previous) = contexts.insert(root.clone(), replacement) {
                        previous.mark_retired();
                        retired.push(previous);
                    }
                    if self.is_primary_boundary(&root) {
                        self.project_contexts.retired.store(true, Ordering::Release);
                        accepted_primary = true;
                    }
                }
                Err(error) => {
                    tracing::warn!(project = %root.display(), %error, "Keeping the last good project configuration");
                    self.project_contexts
                        .pending_config_reloads
                        .lock()
                        .insert(root.clone());
                    if direct_change {
                        result.errors.push(reload_error(&root, &changed));
                    }
                    result.rejected.push((root, changed));
                }
            }
        }
        drop(contexts);
        let affected_documents = self
            .documents
            .iter()
            .filter_map(|document| {
                document
                    .key()
                    .to_file_path()
                    .ok()
                    .map(|path| physical_path(&path))
                    .filter(|path| {
                        published_roots
                            .iter()
                            .any(|root| path.starts_with(physical_path(root)))
                    })
                    .map(|_| (document.key().clone(), document.value().version))
            })
            .collect::<Vec<_>>();
        // A newly created marker can move a document out of the primary
        // owner before any child context exists. Drop that old virtual view;
        // the watcher prepares the current buffer in the new owner below.
        #[cfg(test)]
        if routing_change.is_some() {
            super::lock_order_tests::before_route_changes();
        }
        let moved_primary_documents = affected_documents
            .iter()
            .filter(|(uri, _)| {
                self.project_contexts
                    .routes
                    .get(uri)
                    .is_some_and(|previous| {
                        routing_change.is_some()
                            && self.is_primary_boundary(&previous)
                            && uri
                                .to_file_path()
                                .ok()
                                .and_then(|path| self.document_context_root(&path))
                                .is_some_and(|current| current != *previous)
                    })
            })
            .map(|(uri, _)| uri.clone())
            .collect::<Vec<_>>();
        if routing_change.is_some() {
            self.project_contexts.routes.clear();
        }
        if accepted_primary {
            self.retire_project_owner();
        }
        for previous in retired {
            previous.retire();
        }
        for uri in moved_primary_documents {
            self.remove_virtual_docs(&uri);
        }
        result.documents = affected_documents;
        result
    }
}

pub(super) fn excluded_config_path(path: &std::path::Path, roots: &[std::path::PathBuf]) -> bool {
    let relative = roots
        .iter()
        .filter_map(|root| {
            path.strip_prefix(root)
                .ok()
                .map(|relative| (root, relative))
        })
        .max_by_key(|(root, _)| root.components().count())
        .map(|(_, relative)| relative);
    relative.is_some_and(|relative| {
        relative.components().any(|part| {
            matches!(part, std::path::Component::Normal(name) if matches!(
                name.to_str(),
                Some("node_modules" | ".git" | "target" | "dist" | "build")
            ))
        })
    })
}
