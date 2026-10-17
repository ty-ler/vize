//! One evaluation of the workspace config for an editor session.

use std::path::{Path, PathBuf};

use crate::config::{
    ConfigFeatureFlags, ConfigLintRuleOptions, LanguageServerUnstableFlags, LinterConfig,
    VizeConfig,
};

use super::{
    LoadedProjectConfig, LoadedRawConfig, checked::load_raw_editor_config_attempt,
    project_config_snapshot,
};

/// All LSP config values derived from one raw config evaluation.
#[derive(Debug, Clone)]
pub struct LoadedLspConfig {
    /// Configuration was absent or successfully parsed in this one evaluation.
    pub valid: bool,
    /// Evaluation failure retained for an editor-visible reload error.
    pub error: Option<std::string::String>,
    /// Last attempt's actual inputs and missing candidates, for repair watching
    /// only. These paths never make a failed configuration authoritative.
    pub watch_dependencies: Vec<PathBuf>,
    /// The same raw evaluation retains ordered lint scopes and selected root.
    pub project: LoadedProjectConfig,
    pub config: VizeConfig,
    pub source_path: Option<PathBuf>,
    pub features: ConfigFeatureFlags,
    pub linter: LinterConfig,
    pub lint_rule_options: ConfigLintRuleOptions,
    pub language_server_unstable_flags: LanguageServerUnstableFlags,
    pub request_timeout_ms: u64,
    /// Authored compiler whitespace from this same checked evaluation.
    pub compiler_whitespace: Option<&'static str>,
}

/// Evaluate JS/TS/PKL only once so the editor timeout and type checker
/// settings always come from the same config snapshot.
pub fn load_lsp_config_snapshot(path: Option<&Path>) -> LoadedLspConfig {
    let attempt = load_raw_editor_config_attempt(path);
    let (loaded, error) = match attempt.outcome {
        Ok(loaded) => (loaded, None),
        Err(error) => {
            eprintln!("Warning: Failed to load editor project configuration: {error}");
            (
                LoadedRawConfig {
                    config: Default::default(),
                    source_path: None,
                },
                Some(error),
            )
        }
    };
    let mut snapshot = LoadedLspConfig::from_project(project_config_snapshot(loaded));
    snapshot.valid = error.is_none();
    snapshot.error = error;
    snapshot.watch_dependencies = attempt.dependencies;
    snapshot
}

impl LoadedLspConfig {
    fn from_project(project: LoadedProjectConfig) -> Self {
        let document = &project.document;
        let compiler_whitespace = document.compiler_whitespace();
        let linter = document.linter();
        let lint_rule_options = document.lint_rule_options().clone();
        let language_server_unstable_flags = document.language_server_unstable_flags();
        let request_timeout_ms = document.lsp_request_timeout_ms();
        let (config, features) = document.clone().into_config_and_features();
        let source_path = project.source_path.clone();
        Self {
            valid: true,
            error: None,
            watch_dependencies: Vec::new(),
            project,
            config,
            source_path,
            features,
            linter,
            lint_rule_options,
            language_server_unstable_flags,
            request_timeout_ms,
            compiler_whitespace,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::load_lsp_config_snapshot;

    #[test]
    fn missing_explicit_vite_file_remains_a_watch_input_until_created() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("vite.config.mjs");
        let missing = load_lsp_config_snapshot(Some(&path));
        assert!(!missing.valid);
        assert!(missing.watch_dependencies.contains(&path));
        std::fs::write(&path, "export default { vue: {} };").unwrap();
        let created = load_lsp_config_snapshot(Some(&path));
        assert!(created.valid, "{:?}", created.error);
        assert!(created.watch_dependencies.contains(&path));
        assert_eq!(created.source_path, Some(path));
    }

    #[test]
    fn every_encountered_retired_file_remains_observable_until_deletion_repairs_discovery() {
        let root = tempfile::tempdir().unwrap();
        let paths = [
            root.path().join("vize.config.json"),
            root.path().join("vize.config.ts"),
        ];
        for path in &paths {
            std::fs::write(path, "historical bytes are never evaluated").unwrap();
        }
        let rejected = load_lsp_config_snapshot(Some(root.path()));
        assert!(!rejected.valid);
        for path in &paths {
            assert!(rejected.watch_dependencies.contains(path));
        }
        std::fs::remove_file(&paths[0]).unwrap();
        let retained = load_lsp_config_snapshot(Some(root.path()));
        assert!(!retained.valid);
        assert!(retained.watch_dependencies.contains(&paths[1]));
        std::fs::remove_file(&paths[1]).unwrap();
        let repaired = load_lsp_config_snapshot(Some(root.path()));
        assert!(repaired.valid, "{:?}", repaired.error);
        assert!(repaired.source_path.is_none());
        assert!(
            repaired
                .watch_dependencies
                .iter()
                .any(|path| path.ends_with("vite.config.mjs"))
        );
        assert!(
            !repaired
                .watch_dependencies
                .contains(&root.path().to_path_buf())
        );
    }
}
