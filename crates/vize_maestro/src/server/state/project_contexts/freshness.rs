//! Configuration-only freshness at operation boundaries; native queries retain
//! admitted compiler authority and never parse live configuration themselves.
use super::{
    Arc, LoadedLspConfig, Path, PathBuf, ProjectContextKey, RetainedConfiguration, ServerState, Url,
};
use vize_canon::ConfigurationObservations;

#[derive(Clone)]
pub(in crate::server::state) struct ConfigurationObservation {
    observations: ConfigurationObservations,
    vite_paths: Vec<PathBuf>,
    unverified: bool,
    retry_unobservable: bool,
    notified_failure: bool,
}

impl ConfigurationObservation {
    pub(in crate::server::state) fn initial(
        raw: &LoadedLspConfig,
        loaded: &LoadedLspConfig,
        compiler: ConfigurationObservations,
        accepted: bool,
    ) -> Self {
        if !accepted {
            return Self::failed(raw, loaded, &compiler);
        }
        let mut observations = compiler;
        observations.extend(&ConfigurationObservations::capture(
            &loaded.watch_dependencies,
        ));
        Self {
            observations,
            vite_paths: raw.watch_dependencies.clone(),
            // Public Vite bundling reports paths after evaluation, not consumed
            // bytes. Confirm these paths once at the next operation boundary.
            unverified: !raw.watch_dependencies.is_empty(),
            retry_unobservable: false,
            notified_failure: false,
        }
    }

    pub(super) fn checked(
        raw: &LoadedLspConfig,
        applied: &LoadedLspConfig,
        before: &ConfigurationObservations,
        compiler: &ConfigurationObservations,
    ) -> Self {
        let mut observations = before.clone();
        observations.extend(compiler);
        let known = before.paths();
        let unverified = raw
            .watch_dependencies
            .iter()
            .any(|path| !known.contains(path));
        // This post-read observes future repair only. `unverified` explicitly
        // prevents it from being represented as an evaluated-byte receipt.
        observations.extend(&ConfigurationObservations::capture(
            &applied.watch_dependencies,
        ));
        Self {
            observations,
            vite_paths: raw.watch_dependencies.clone(),
            unverified,
            retry_unobservable: false,
            notified_failure: false,
        }
    }

    pub(super) fn failed(
        raw: &LoadedLspConfig,
        loaded: &LoadedLspConfig,
        observed: &ConfigurationObservations,
    ) -> Self {
        let mut paths = observed.paths();
        paths.extend(loaded.watch_dependencies.iter().cloned());
        paths.extend(loaded.project.dependencies.iter().cloned());
        Self {
            // A rejected attempt's end-state is only a suppression/repair
            // baseline. It never supplies compiler options or source authority.
            observations: ConfigurationObservations::capture(&paths),
            vite_paths: raw.watch_dependencies.clone(),
            unverified: false,
            retry_unobservable: !raw.watch_dependencies_complete,
            notified_failure: false,
        }
    }

    fn changes(&self) -> Vec<PathBuf> {
        if self.unverified || self.retry_unobservable {
            self.observations.paths()
        } else {
            self.observations.changed_paths()
        }
    }

    pub(super) fn repeats_notified_failure(&self) -> bool {
        self.notified_failure && self.observations.changed_paths().is_empty()
    }

    pub(super) fn mark_failure_notified(&mut self) {
        self.notified_failure = true;
    }

    fn paths(&self) -> Vec<PathBuf> {
        self.observations.paths()
    }
}

impl ServerState {
    pub(super) fn prepare_configuration_attempt(
        key: &ProjectContextKey,
        raw: &LoadedLspConfig,
        before: &ConfigurationObservations,
        dependencies: &[PathBuf],
    ) -> (
        Result<RetainedConfiguration, vize_l0::String>,
        ConfigurationObservation,
    ) {
        let mut compiler_observations = ConfigurationObservations::default();
        let mut applied = raw.clone();
        let snapshot = if let Some(error) = &raw.error {
            Err(vize_l0::String::from(error.as_str()))
        } else {
            Self::prepare_tsconfig_config_snapshot(&key.root, Some(key), &mut applied, &mut compiler_observations)
                .map(|compiler| RetainedConfiguration {
                    observation: ConfigurationObservation::checked(raw, &applied, before, &compiler_observations),
                    authored: raw.clone(), applied: applied.clone(), compiler,
                })
        }.and_then(|snapshot| {
            if before.changed_paths().is_empty() { Ok(snapshot) } else {
                Err(vize_l0::cstr!("project configuration changed during evaluation; keeping the last good configuration"))
            }
        });
        compiler_observations.extend(before);
        let observation = match &snapshot {
            Ok(snapshot) => snapshot.observation.clone(),
            Err(_) => {
                compiler_observations.extend(&ConfigurationObservations::capture(dependencies));
                ConfigurationObservation::failed(raw, &applied, &compiler_observations)
            }
        };
        (snapshot, observation)
    }

    fn configuration_records(&self) -> Vec<(ProjectContextKey, ConfigurationObservation)> {
        let mut records = self
            .project_contexts
            .contexts
            .lock()
            .iter()
            .filter_map(|(key, context)| {
                context
                    .configuration_observation()
                    .map(|record| (key.clone(), record))
            })
            .collect::<vize_l0::FxHashMap<_, _>>();
        if let Some(record) = self
            .project_contexts
            .configuration_observation
            .read()
            .clone()
            && let Some(root) = self
                .project_contexts
                .boundary
                .read()
                .clone()
                .or_else(|| self.get_workspace_root())
        {
            records.entry(root.into()).or_insert(record);
        }
        // Latest failed attempts supersede admission observations for polling,
        // while admitted dependencies remain separately watched below.
        records.extend(self.project_contexts.configuration_attempts.lock().clone());
        records.into_iter().collect()
    }

    pub(super) fn configuration_paths_for_key(&self, key: &ProjectContextKey) -> Vec<PathBuf> {
        self.project_contexts
            .configuration_attempts
            .lock()
            .get(key)
            .map(ConfigurationObservation::paths)
            .unwrap_or_default()
    }

    pub(super) fn configuration_vite_paths_for_root(&self, root: &Path) -> Vec<PathBuf> {
        let mut paths = self
            .configuration_records()
            .into_iter()
            .filter(|(key, _)| key.root == root)
            .flat_map(|(_, record)| record.vite_paths)
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        paths
    }

    pub(super) fn configuration_watch_paths_for_root(&self, root: &Path) -> Vec<PathBuf> {
        let mut paths = self
            .configuration_records()
            .into_iter()
            .filter(|(key, _)| key.root == root)
            .flat_map(|(_, record)| record.paths())
            .collect::<Vec<_>>();
        if self.is_primary_boundary(root) {
            paths.extend(
                self.project_contexts
                    .config_dependencies
                    .read()
                    .iter()
                    .cloned(),
            );
        }
        for (key, context) in self.project_contexts.contexts.lock().iter() {
            if key.root == root {
                paths.extend(context.config_dependencies());
            }
        }
        paths.sort();
        paths.dedup();
        paths
    }

    /// Admitted and latest-attempt dependencies, solely for repair watching.
    pub(crate) fn configuration_watch_paths(&self) -> Vec<PathBuf> {
        if let Some(owner) = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(super::Weak::upgrade)
        {
            return owner.configuration_watch_paths();
        }
        let mut roots = self
            .configuration_records()
            .into_iter()
            .map(|(key, _)| key.root)
            .collect::<Vec<_>>();
        roots.sort();
        roots.dedup();
        let mut paths = roots
            .iter()
            .flat_map(|root| self.configuration_watch_paths_for_root(root))
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        paths
    }

    pub(crate) async fn refresh_document_configuration_async(
        self: &Arc<Self>,
        uri: &Url,
    ) -> super::config_reload::ProjectConfigChanges {
        let owner = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(super::Weak::upgrade);
        let state = owner.as_ref().unwrap_or(self);
        let Some(root) = uri
            .to_file_path()
            .ok()
            .and_then(|path| state.document_context_root(&path))
        else {
            return Default::default();
        };
        let gates = state.config_reload_gates(std::slice::from_ref(&root));
        let Some(gate) = gates.first() else {
            return Default::default();
        };
        let admission = gate.clone().lock_owned().await;
        let worker = state.clone();
        Self::project_background(move || {
            let _admission = admission;
            let mut affected = Vec::new();
            let mut changes = Vec::new();
            for (key, record) in worker
                .configuration_records()
                .into_iter()
                .filter(|(key, _)| key.root == root)
            {
                let changed = record.changes();
                if !changed.is_empty() {
                    affected.push(key);
                    changes.extend(
                        changed
                            .into_iter()
                            .filter_map(|path| Url::from_file_path(path).ok()),
                    );
                }
            }
            changes.sort();
            changes.dedup();
            if changes.is_empty() || worker.project_routing_shutting_down() {
                return Default::default();
            }
            if affected.iter().any(|key| key.tsconfig.is_none()) {
                affected.extend(
                    worker
                        .project_contexts
                        .contexts
                        .lock()
                        .iter()
                        .filter(|(key, context)| {
                            key.root == root
                                && key.tsconfig.is_some()
                                && context.initialized_state().is_none()
                        })
                        .map(|(key, _)| key.clone()),
                );
            }
            affected.sort_by(|a, b| (&a.root, &a.tsconfig).cmp(&(&b.root, &b.tsconfig)));
            affected.dedup();
            let scope = super::watched::ConfigEventScope::for_owners(affected);
            // One checked attempt, with the same per-root admission/CAS route
            // as file watching. No synthetic protocol notification or retry loop.
            worker.apply_project_config_paths(&changes, scope)
        })
        .await
        .unwrap_or_else(|| {
            if state.project_routing_shutting_down() {
                return Default::default();
            }
            super::config_reload::ProjectConfigChanges {
                errors: vec![super::config_reload::worker_unavailable_error()],
                ..Default::default()
            }
        })
    }
}
