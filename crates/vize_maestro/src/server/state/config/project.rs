//! TypeScript project authority complements the shared Vite snapshot.
use std::path::Path;
#[expect(
    clippy::disallowed_types,
    reason = "immutable snapshots are shared by editor owners"
)]
use std::sync::Arc;

use super::{ServerState, host::LoadedLspConfig};

impl ServerState {
    pub(super) fn apply_tsconfig_config_snapshot(
        &self,
        directory: &Path,
        loaded: &mut LoadedLspConfig,
    ) -> bool {
        let key = self.project_contexts.key.read().clone();
        match Self::prepare_tsconfig_config_snapshot(directory, key.as_ref(), loaded) {
            Ok(compiler) => {
                *self.project_contexts.config_dependencies.write() =
                    loaded.project.dependencies.clone();
                *self.project_contexts.compiler_configuration.write() = Some(compiler);
                true
            }
            Err(error) => {
                tracing::warn!("Failed to resolve project configuration: {error}");
                false
            }
        }
    }

    pub(in crate::server::state) fn prepare_tsconfig_config_snapshot(
        directory: &Path,
        key: Option<&super::super::project_contexts::ProjectContextKey>,
        loaded: &mut LoadedLspConfig,
    ) -> Result<Arc<vize_canon::CompilerConfigurationSnapshot>, vize_l0::String> {
        let root = loaded.project.project_root.as_deref().unwrap_or(directory);
        let base = loaded
            .source_path
            .as_deref()
            .and_then(Path::parent)
            .unwrap_or(directory);
        let selected = key
            .and_then(|key| key.tsconfig.clone())
            .or_else(|| {
                loaded
                    .config
                    .type_checker
                    .tsconfig
                    .as_deref()
                    .map(|path| base.join(path))
            })
            .unwrap_or_else(|| {
                [
                    root.join("tsconfig.json"),
                    root.join("jsconfig.json"),
                    base.join("tsconfig.json"),
                    base.join("jsconfig.json"),
                ]
                .into_iter()
                .find(|path| path.is_file())
                .unwrap_or_else(|| root.join("tsconfig.json"))
            });
        if !selected.is_file()
            && (key.is_some_and(|key| key.tsconfig.is_some())
                || loaded.config.type_checker.tsconfig.is_some())
        {
            return Err(vize_l0::cstr!(
                "selected TypeScript configuration does not exist: {}",
                selected.display()
            ));
        }
        let mut dependencies = loaded.project.dependencies.clone();
        let compiler;
        if selected.is_file() {
            // Keep the checker on the same TS project when Vite moves the source root.
            loaded.config.type_checker.tsconfig =
                Some(selected.to_string_lossy().into_owned().into());
            let snapshot =
                vize_canon::CompilerConfigurationSnapshot::capture(root, Some(&selected))
                    .map_err(|error| vize_l0::cstr!("{error}"))?;
            dependencies.extend(snapshot.dependencies().iter().cloned());
            compiler = Arc::new(snapshot);
            // Authored Vite dialects, including Vue 3, take precedence.
            let source_owner = key.is_some_and(|key| key.tsconfig.is_some());
            let solution_shell = !source_owner
                && vize_canon::batch::TsconfigOwnershipCache::default()
                    .project_paths(&selected)
                    .len()
                    > 1;
            if loaded.features.vue_version.is_none() && !solution_shell {
                match vize_canon::snapshot_tsconfig_vue_target(root, &selected) {
                    Ok(Some(version)) => {
                        loaded.features.vue_version = Some(version);
                        loaded.features.type_checker_legacy_vue2 |= version.is_legacy();
                    }
                    Ok(None) => {}
                    Err(error) => {
                        return Err(vize_l0::cstr!("{error}"));
                    }
                }
            }
        } else {
            let snapshot = vize_canon::CompilerConfigurationSnapshot::capture(root, None)
                .map_err(|error| vize_l0::cstr!("{error}"))?;
            dependencies.extend(snapshot.dependencies().iter().cloned());
            compiler = Arc::new(snapshot);
        }
        dependencies.push(selected);
        dependencies.sort();
        dependencies.dedup();
        loaded.project.dependencies = dependencies;
        Ok(compiler)
    }
}
