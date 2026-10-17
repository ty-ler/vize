//! Immutable compiler authority admitted by one editor project owner.

use std::path::{Path, PathBuf};
#[expect(
    clippy::disallowed_types,
    reason = "immutable snapshots are shared by editor owners"
)]
use std::sync::Arc;

use serde_json::{Map, Value};

use super::super::VirtualProject;
use super::compiler_options::FlattenedCompilerOptions;
use crate::batch::error::{CorsaError, CorsaResult};

/// Effective options and their original path anchors survive a rejected editor
/// reload. Source buffers and package files remain live; only the admitted
/// compiler configuration is retained until its owner is replaced.
#[derive(Clone)]
#[expect(
    clippy::disallowed_types,
    reason = "serde_json object keys use std String"
)]
pub struct CompilerConfigurationSnapshot {
    project_root: PathBuf,
    tsconfig_path: Option<PathBuf>,
    pub(super) flattened: FlattenedCompilerOptions,
    pub(super) verbatim: Map<std::string::String, Value>,
    pub(super) vue_options: Map<std::string::String, Value>,
    dependencies: Vec<PathBuf>,
}

#[cfg(test)]
#[path = "compiler_snapshot_tests.rs"]
mod tests;

impl CompilerConfigurationSnapshot {
    /// Capture through the same checked resolver used by batch materialization.
    pub fn capture(project_root: &Path, tsconfig_path: Option<&Path>) -> CorsaResult<Self> {
        let project = VirtualProject::new(project_root)?;
        let flattened = project.load_compiler_options_flattened(tsconfig_path)?;
        let verbatim = project.load_compiler_options_verbatim(tsconfig_path)?;
        let vue_options = super::vue_compiler_options::load_vue_compiler_options(tsconfig_path)?;
        let mut configured = project;
        configured.set_tsconfig_path(tsconfig_path.map(Path::to_path_buf));
        let dependencies = if tsconfig_path.is_some() {
            configured.governing_config_paths()
        } else {
            vec![
                configured.project_root().join("tsconfig.json"),
                configured.project_root().join("jsconfig.json"),
            ]
        };
        Ok(Self {
            project_root: configured.project_root().to_path_buf(),
            tsconfig_path: tsconfig_path.map(Path::to_path_buf),
            flattened,
            verbatim,
            vue_options,
            dependencies,
        })
    }

    pub(crate) fn tsconfig_path(&self) -> Option<&Path> {
        self.tsconfig_path.as_deref()
    }

    /// Config and Vue-manifest inputs retained for watcher repair.
    pub fn dependencies(&self) -> &[PathBuf] {
        &self.dependencies
    }
}

impl VirtualProject {
    pub(crate) fn has_admitted_compiler_configuration(&self) -> bool {
        self.compiler_configuration.is_some()
    }

    pub(crate) fn is_admitted_compiler_input(&self, path: &Path) -> bool {
        self.compiler_configuration
            .as_ref()
            .is_some_and(|snapshot| {
                let inputs = if snapshot.tsconfig_path.is_some() {
                    &snapshot.flattened.input_paths
                } else {
                    &snapshot.dependencies
                };
                inputs.contains(&super::super::tsconfig_paths::normalize_path_lexically(
                    path,
                ))
            })
    }

    /// The embedding editor already selected this complete project owner.
    /// Do not select another reference from mutable disk during a rejected reload.
    pub(crate) fn set_compiler_configuration_snapshot(
        &mut self,
        snapshot: Arc<CompilerConfigurationSnapshot>,
    ) -> CorsaResult<()> {
        if self.project_root != snapshot.project_root {
            return Err(CorsaError::Configuration(vize_carton::cstr!(
                "admitted compiler configuration belongs to {}, not {}",
                snapshot.project_root.display(),
                self.project_root.display()
            )));
        }
        let tsconfig = snapshot.tsconfig_path.clone();
        self.compiler_configuration = Some(snapshot);
        self.set_tsconfig_path(tsconfig);
        Ok(())
    }
}
