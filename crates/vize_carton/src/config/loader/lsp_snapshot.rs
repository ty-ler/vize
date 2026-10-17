//! One evaluation of the workspace config for an editor session.

use std::path::{Path, PathBuf};

use crate::config::{
    ConfigFeatureFlags, ConfigLintRuleOptions, LanguageServerUnstableFlags, LinterConfig,
    VizeConfig,
};

use super::{
    LoadedProjectConfig, LoadedRawConfig, checked::load_raw_editor_config_checked,
    project_config_snapshot,
};

/// All LSP config values derived from one raw config evaluation.
#[derive(Debug, Clone)]
pub struct LoadedLspConfig {
    /// Configuration was absent or successfully parsed in this one evaluation.
    pub valid: bool,
    /// Evaluation failure retained for an editor-visible reload error.
    pub error: Option<std::string::String>,
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
    let (loaded, error) = match load_raw_editor_config_checked(path) {
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
