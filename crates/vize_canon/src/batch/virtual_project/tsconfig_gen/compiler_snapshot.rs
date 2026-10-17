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
    vue_target: Result<Option<vize_carton::config::VueVersion>, vize_carton::String>,
    solution_shell: bool,
}

#[cfg(test)]
#[path = "compiler_snapshot_tests.rs"]
mod tests;

impl CompilerConfigurationSnapshot {
    /// Capture with consistent per-file reads and resolution outcomes through
    /// the existing checked resolver, then validate every observed input once.
    /// Changes reject admission; this is not a multi-file filesystem transaction.
    pub fn capture(project_root: &Path, tsconfig_path: Option<&Path>) -> CorsaResult<Self> {
        Self::capture_with_observer(project_root, tsconfig_path, || {})
    }

    fn capture_with_observer(
        project_root: &Path,
        tsconfig_path: Option<&Path>,
        after_flattened: impl FnOnce(),
    ) -> CorsaResult<Self> {
        let inputs = super::compiler_inputs::CompilerInputs::default();
        let normalized = tsconfig_path
            .map(|path| vize_carton::path::normalize_windows_verbatim_path(path.to_path_buf()));
        let tsconfig_path = normalized.as_deref();
        let project = VirtualProject::new(project_root)?;
        let implicit_candidates = [
            project.project_root().join("tsconfig.json"),
            project.project_root().join("jsconfig.json"),
        ];
        if tsconfig_path.is_none() {
            for path in &implicit_candidates {
                inputs.observe(path);
                if path.is_file() {
                    return Err(CorsaError::Configuration(vize_carton::cstr!(
                        "TypeScript configuration {} appeared while admitting configuration absence",
                        path.display()
                    )));
                }
            }
        }
        let flattened =
            project.load_compiler_options_flattened_with_inputs(tsconfig_path, Some(&inputs))?;
        after_flattened();
        let verbatim =
            project.load_compiler_options_verbatim_with_inputs(tsconfig_path, Some(&inputs))?;
        let vue_options = super::vue_compiler_options::load_vue_compiler_options_with_inputs(
            tsconfig_path,
            Some(&inputs),
        )?;
        let vue_target = tsconfig_path
            .map_or(Ok(None), |path| {
                super::vue_compiler_options::vue_target_from_options(
                    project_root,
                    path,
                    &vue_options,
                    Some(&inputs),
                )
            })
            .map_err(|error| vize_carton::cstr!("{error}"));
        let solution_shell = tsconfig_path.is_some_and(|path| {
            super::references::graph::collect_project_paths_with_inputs(path, Some(&inputs)).len()
                > 1
        });
        let mut configured = project;
        // Dependency traversal uses the same input cache; avoid the live-policy
        // refresh performed by the public setter during ordinary source loading.
        configured.tsconfig_path = tsconfig_path.map(Path::to_path_buf);
        let mut dependencies = if tsconfig_path.is_some() {
            configured.governing_config_paths_with_inputs(Some(&inputs))
        } else {
            implicit_candidates.to_vec()
        };
        dependencies.extend(inputs.paths());
        dependencies.sort();
        dependencies.dedup();
        inputs.validate()?;
        Ok(Self {
            project_root: configured.project_root().to_path_buf(),
            tsconfig_path: tsconfig_path.map(Path::to_path_buf),
            flattened,
            verbatim,
            vue_options,
            dependencies,
            vue_target,
            solution_shell,
        })
    }

    /// The dialect resolved from these same captured options and Vue manifest.
    /// Callers apply an explicitly authored Vite dialect before consulting it.
    pub fn vue_target(
        &self,
    ) -> Result<Option<vize_carton::config::VueVersion>, vize_carton::String> {
        self.vue_target.clone()
    }

    /// Whether the captured selected config is a project-reference shell.
    pub fn is_solution_shell(&self) -> bool {
        self.solution_shell
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
    #[expect(
        clippy::disallowed_types,
        reason = "the admitted immutable owner shares compiler authority across native rebuilds"
    )]
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
