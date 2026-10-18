//! Global requests target current owners; idle packages stay uninitialized.
use super::{Arc, Ordering, ProjectContextKey, ProjectContexts, ServerState, Url, Weak};

/// Only the queued sync/type stages of this exact opened buffer may continue
/// its admission. This is never an evaluated-byte receipt for Vite imports.
#[derive(Clone)]
pub(crate) struct InitialConfigurationContinuation {
    uri: Url,
    version: i32,
    owner: Weak<ServerState>,
    key: ProjectContextKey,
    routing: u64,
    source: super::super::CorsaRequestStamp,
    compiler: Arc<vize_canon::CompilerConfigurationSnapshot>,
    records: Vec<(
        ProjectContextKey,
        super::freshness::ConfigurationObservation,
    )>,
}

impl InitialConfigurationContinuation {
    fn records(
        &self,
        root: &ServerState,
    ) -> Vec<(
        ProjectContextKey,
        super::freshness::ConfigurationObservation,
    )> {
        let mut records = root
            .configuration_records()
            .into_iter()
            .filter(|(key, _)| key.root == self.key.root)
            .collect::<Vec<_>>();
        records.sort_by(|(a, _), (b, _)| a.tsconfig.cmp(&b.tsconfig));
        records
    }

    fn owner_is_current(
        &self,
        root: &ServerState,
        uri: &Url,
        version: i32,
    ) -> Option<Arc<ServerState>> {
        let owner = self.owner.upgrade()?;
        if uri != &self.uri
            || version != self.version
            || owner.documents.version(uri) != Some(version)
            || !self.source.is_current(&owner)
            || root.project_routing_shutting_down()
            || root.stable_project_routing_generation() != Some(self.routing)
            || root.document_configuration_root(uri).as_ref() != Some(&self.key.root)
            || root.project_contexts.routes.get(uri).as_deref() != Some(&self.key)
            || !owner
                .project_contexts
                .compiler_configuration
                .read()
                .as_ref()
                .is_some_and(|compiler| Arc::ptr_eq(compiler, &self.compiler))
        {
            return None;
        }
        let context = root
            .project_contexts
            .contexts
            .lock()
            .get(&self.key)
            .cloned();
        if context
            .as_ref()
            .and_then(|context| context.initialized_state())
            .is_some_and(|current| Arc::ptr_eq(&current, &owner))
            || (context.is_none()
                && std::ptr::eq(root, owner.as_ref())
                && root.is_primary_boundary(&self.key.root))
        {
            Some(owner)
        } else {
            None
        }
    }

    fn validate(&self, root: &ServerState, uri: &Url, version: i32) -> Option<Arc<ServerState>> {
        self.owner_is_current(root, uri, version)?;
        let records = self.records(root);
        if records != self.records
            || records
                .iter()
                .any(|(_, record)| !record.changes().is_empty())
        {
            return None;
        }
        #[cfg(test)]
        super::lock_order_tests::before_initial_continuation();
        // Recheck after the physical reads. No old observation is acknowledged
        // or made verified, and no configuration lock survives the reads.
        if self.records(root) != self.records
            || self
                .records
                .iter()
                .any(|(_, record)| !record.changes().is_empty())
            || self.records(root) != self.records
        {
            return None;
        }
        self.owner_is_current(root, uri, version)
    }

    pub(crate) fn root(&self) -> &std::path::Path {
        &self.key.root
    }
}

pub(crate) struct RoutingChange<'a>(&'a ProjectContexts);

impl Drop for RoutingChange<'_> {
    fn drop(&mut self) {
        self.0.generation.fetch_add(1, Ordering::AcqRel);
        self.0.routing_changes.fetch_sub(1, Ordering::AcqRel);
    }
}

impl ServerState {
    fn configuration_owner(self: &Arc<Self>) -> Arc<Self> {
        self.project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| self.clone())
    }

    pub(crate) fn initial_configuration_continuation(
        self: &Arc<Self>,
        uri: &Url,
        version: i32,
    ) -> Option<InitialConfigurationContinuation> {
        let root = self.configuration_owner();
        let key = root.project_contexts.routes.get(uri)?.value().clone();
        let mut records = root
            .configuration_records()
            .into_iter()
            .filter(|(candidate, _)| candidate.root == key.root)
            .collect::<Vec<_>>();
        records.sort_by(|(a, _), (b, _)| a.tsconfig.cmp(&b.tsconfig));
        if !records.iter().any(|(candidate, _)| candidate == &key)
            || records
                .iter()
                .any(|(_, record)| !record.admits_initial_continuation())
        {
            return None;
        }
        let continuation = InitialConfigurationContinuation {
            uri: uri.clone(),
            version,
            owner: Arc::downgrade(self),
            key,
            routing: root.stable_project_routing_generation()?,
            source: self.corsa_request_stamp(),
            compiler: self
                .project_contexts
                .compiler_configuration
                .read()
                .clone()?,
            records,
        };
        continuation.owner_is_current(&root, uri, version)?;
        Some(continuation)
    }

    pub(crate) async fn continue_initial_configuration(
        self: &Arc<Self>,
        continuation: InitialConfigurationContinuation,
        uri: Url,
        version: i32,
    ) -> Option<Arc<Self>> {
        let root = self.configuration_owner();
        let gate = root
            .config_reload_gates(std::slice::from_ref(&continuation.key.root))
            .into_iter()
            .next()?;
        let admission = gate.lock_owned().await;
        let worker_root = root.clone();
        let worker_continuation = continuation.clone();
        let worker_uri = uri.clone();
        let owner = Self::project_background(move || {
            let _admission = admission;
            worker_continuation.validate(&worker_root, &worker_uri, version)
        })
        .await
        .flatten()?;
        if continuation.records(&root) != continuation.records {
            return None;
        }
        continuation.owner_is_current(&root, &uri, version)?;
        Some(owner)
    }

    pub(crate) fn project_routing_change(&self) -> RoutingChange<'_> {
        self.project_contexts
            .routing_changes
            .fetch_add(1, Ordering::AcqRel);
        self.project_contexts
            .generation
            .fetch_add(1, Ordering::AcqRel);
        RoutingChange(&self.project_contexts)
    }

    pub(crate) fn stable_project_routing_generation(&self) -> Option<u64> {
        if let Some(owner) = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(Weak::upgrade)
        {
            return owner.stable_project_routing_generation();
        }
        if self
            .project_contexts
            .routing_changes
            .load(Ordering::Acquire)
            != 0
        {
            return None;
        }
        let generation = self.project_routing_generation();
        (self
            .project_contexts
            .routing_changes
            .load(Ordering::Acquire)
            == 0)
            .then_some(generation)
    }

    pub(crate) fn project_routing_shutting_down(&self) -> bool {
        if let Some(owner) = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(Weak::upgrade)
        {
            return owner.project_routing_shutting_down();
        }
        self.project_contexts.shutting_down.load(Ordering::Acquire)
    }

    pub(crate) fn project_routing_generation(&self) -> u64 {
        if let Some(owner) = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(Weak::upgrade)
        {
            return owner.project_routing_generation();
        }
        self.project_contexts.generation.load(Ordering::Acquire)
    }

    pub(crate) fn current_primary_project_state(self: &Arc<Self>) -> Arc<Self> {
        if self.project_routing_shutting_down() {
            return self.clone();
        }
        if let Some(owner) = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(Weak::upgrade)
        {
            return owner.current_primary_project_state();
        }
        loop {
            let root = self
                .project_contexts
                .boundary
                .read()
                .clone()
                .or_else(|| self.get_workspace_root());
            let context = root.and_then(|root| {
                self.project_contexts
                    .contexts
                    .lock()
                    .get(&root.into())
                    .cloned()
            });
            let Some(context) = context else {
                return self.clone();
            };
            if let Some(state) = context.initialize(self) {
                return state;
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn current_project_states(self: &Arc<Self>) -> Vec<Arc<Self>> {
        if let Some(owner) = self
            .project_contexts
            .owner
            .read()
            .as_ref()
            .and_then(Weak::upgrade)
        {
            return owner.current_project_states();
        }
        let primary = self.current_primary_project_state();
        let mut states = self.cached_project_states();
        if !states.iter().any(|state| Arc::ptr_eq(state, &primary)) {
            states.push(primary);
        }
        states.retain(|state| !state.project_context_retired());
        states
    }
}

#[cfg(test)]
mod tests {
    use super::{Arc, ServerState};
    use tower_lsp::lsp_types::{FileChangeType, FileEvent, Url};

    #[test]
    fn initial_continuation_rechecks_physical_and_queue_identity_after_its_first_read() {
        #[derive(Clone, Copy, Debug)]
        enum Mutation {
            Config,
            Source,
            Routing,
            Replacement,
        }
        use Mutation::{Config, Replacement, Routing, Source};

        for control in [Config, Source, Routing, Replacement] {
            let directory = tempfile::tempdir().unwrap();
            let config = directory.path().join("vite.config.mjs");
            std::fs::write(&config, "export default {vue:{}};").unwrap();
            let owner = Arc::new(ServerState::new());
            owner.set_workspace_root(directory.path().to_path_buf());
            owner.load_workspace_config(directory.path());
            let uri = Url::from_file_path(directory.path().join("App.vue")).unwrap();
            owner
                .documents
                .open(uri.clone(), "<template />".into(), 1, "vue".into());
            let current = owner
                .document_project_state(&uri)
                .unwrap_or_else(|| owner.clone());
            assert!(Arc::ptr_eq(&current, &owner));
            assert!(owner.project_contexts.contexts.lock().is_empty());
            let receipt = current.initial_configuration_continuation(&uri, 1).unwrap();
            assert!(receipt.validate(&owner, &uri, 1).is_some());
            let changed = owner.clone();
            let changed_uri = uri.clone();
            let key = owner
                .project_contexts
                .routes
                .get(&uri)
                .unwrap()
                .value()
                .clone();
            super::super::lock_order_tests::at_initial_continuation(move || match control {
                Config => std::fs::write(config, "export default {vue:{name:'changed'}};").unwrap(),
                Source => changed.documents.open(
                    changed_uri,
                    "<template>changed</template>".into(),
                    1,
                    "vue".into(),
                ),
                Routing => {
                    let _change = changed.project_routing_change();
                }
                Replacement => {
                    changed.project_contexts.contexts.lock().insert(
                        key.clone(),
                        Arc::new(super::super::registry::ProjectContext::new(key)),
                    );
                }
            });
            assert!(receipt.validate(&owner, &uri, 1).is_none(), "{control:?}");
        }
    }

    #[test]
    fn primary_replacement_is_lazy_unique_and_respects_explicit_options() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("vite.config.mjs");
        std::fs::write(
            &config,
            r#"export default { vue: {"languageServer":{"fileRename":false}} };"#,
        )
        .unwrap();
        let owner = Arc::new(ServerState::new());
        owner.set_workspace_root(root.path().to_path_buf());
        owner.load_workspace_config(root.path());
        owner
            .apply_lsp_initialization_options(Some(&serde_json::json!({"workspaceSymbols":false})));
        assert!(Arc::ptr_eq(&owner, &owner.current_primary_project_state()));
        let generation = owner.project_routing_generation();
        std::fs::write(
            &config,
            r#"export default { vue: {"languageServer":{"fileRename":true,"workspaceSymbols":true}} };"#,
        )
        .unwrap();
        owner.observe_project_config_events(&[FileEvent {
            uri: Url::from_file_path(&config).unwrap(),
            typ: FileChangeType::CHANGED,
        }]);
        assert!(owner.project_routing_generation() > generation);
        assert!(owner.cached_project_states().is_empty());
        let current = owner.current_primary_project_state();
        assert!(!Arc::ptr_eq(&owner, &current));
        assert!(!current.project_context_retired());
        assert!(current.lsp_features().file_rename);
        assert!(!current.lsp_features().workspace_symbols);
        assert!(Arc::ptr_eq(
            &current,
            &owner.current_primary_project_state()
        ));
        let states = owner.current_project_states();
        assert_eq!(states.len(), 1);
        assert!(Arc::ptr_eq(&states[0], &current));
        owner.retire_project_contexts();
        assert!(owner.cached_project_states().is_empty());
        assert!(Arc::ptr_eq(&owner, &owner.current_primary_project_state()));
    }
}
