use std::path::{Path, PathBuf};

use vize_carton::FxHashMap;

use super::{graph, spec::SpecCache};

/// Host path semantics used while matching tsconfig ownership.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TsconfigOwnershipOptions {
    case_sensitive: bool,
}

impl TsconfigOwnershipOptions {
    /// Build an authority for a host whose file names have the given case
    /// semantics. This is public for remote/virtual hosts and deterministic
    /// cross-platform regression tests.
    pub const fn with_case_sensitive(case_sensitive: bool) -> Self {
        Self { case_sensitive }
    }
}

impl Default for TsconfigOwnershipOptions {
    fn default() -> Self {
        Self {
            case_sensitive: host_uses_case_sensitive_file_names(),
        }
    }
}

/// Match TypeScript's host policy: Windows is insensitive; other hosts probe
/// the filesystem containing the running checker by swapping the executable
/// path's ASCII case. This preserves case-sensitive macOS volumes instead of
/// hard-coding an operating-system guess.
fn host_uses_case_sensitive_file_names() -> bool {
    if cfg!(windows) {
        return false;
    }
    let Ok(executable) = std::env::current_exe() else {
        return !cfg!(target_os = "macos");
    };
    let spelled = executable.to_string_lossy();
    let swapped = spelled
        .chars()
        .map(|character| {
            if character.is_ascii_lowercase() {
                character.to_ascii_uppercase()
            } else {
                character.to_ascii_lowercase()
            }
        })
        .collect::<vize_carton::String>();
    swapped == spelled || !Path::new(&swapped).exists()
}

/// Whether membership also requires the owning project to enable `allowJs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsconfigSourceKind {
    /// Vue files and the TypeScript family.
    Typed,
    /// `.js`, `.jsx`, `.mjs`, and `.cjs` inputs.
    JavaScript,
}

/// Run-scoped parsed ownership graph. There is no process-global state: HMR
/// and CLI runs can replace this cache when configuration inputs change.
#[derive(Default)]
pub struct TsconfigOwnershipCache {
    options: TsconfigOwnershipOptions,
    specs: SpecCache,
    project_paths: FxHashMap<PathBuf, Vec<PathBuf>>,
}

impl TsconfigOwnershipCache {
    pub fn with_options(options: TsconfigOwnershipOptions) -> Self {
        Self {
            options,
            ..Self::default()
        }
    }

    /// The root project followed by every transitive reference, in declaration
    /// order and with cycles/deduplicated diamonds visited once.
    pub fn project_paths(&mut self, tsconfig_path: &Path) -> Vec<PathBuf> {
        self.project_paths_consumed(tsconfig_path, false).value
    }

    pub(super) fn project_paths_consumed(
        &mut self,
        tsconfig_path: &Path,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<Vec<PathBuf>> {
        use super::super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let resolved = take(
            &mut facts,
            graph::normalize_path_consumed(tsconfig_path, observe),
        );
        // Same existing map/entry/default execution. An occupied value has no stored facts.
        let mut computed = false;
        let value = self
            .project_paths
            .entry(resolved)
            .or_insert_with_key(|root| {
                let consumed = graph::collect_project_paths_consumed(root, observe);
                computed = true;
                take(&mut facts, consumed)
            })
            .clone();
        if !computed {
            facts.qualified = false;
        }
        finish(facts, value)
    }

    /// Whether a single effective project includes `source_path`.
    pub fn project_owns_source(
        &mut self,
        tsconfig_path: &Path,
        source_path: &Path,
        source_kind: TsconfigSourceKind,
    ) -> bool {
        let case_sensitive = self.options.case_sensitive;
        let Some(spec) = self.specs.load(tsconfig_path) else {
            return false;
        };
        spec.includes(source_path, case_sensitive, source_kind)
    }

    fn project_owns_source_consumed(
        &mut self,
        tsconfig_path: &Path,
        source_path: &Path,
        source_kind: TsconfigSourceKind,
        _observe: bool,
    ) -> crate::package_route::stamp::Consumed<bool> {
        crate::package_route::stamp::Consumed {
            value: self.project_owns_source(tsconfig_path, source_path, source_kind),
            stamps: Vec::new(),
            qualified: false,
        }
    }

    /// The inherited `compilerOptions.allowJs` for one effective project.
    pub fn project_allows_js(&mut self, tsconfig_path: &Path) -> bool {
        self.specs
            .load(tsconfig_path)
            .and_then(|spec| spec.allow_js)
            .unwrap_or(false)
    }

    /// Resolve one source through the complete project-reference graph.
    /// Unowned and multiply-owned inputs fail closed to the root project.
    pub fn effective_config_for_source(
        &mut self,
        tsconfig_path: &Path,
        source_path: &Path,
        source_kind: TsconfigSourceKind,
    ) -> PathBuf {
        self.effective_config_for_source_consumed(tsconfig_path, source_path, source_kind, false)
            .value
    }

    pub(super) fn effective_config_for_source_consumed(
        &mut self,
        tsconfig_path: &Path,
        source_path: &Path,
        source_kind: TsconfigSourceKind,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<PathBuf> {
        use super::super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let projects = take(
            &mut facts,
            self.project_paths_consumed(tsconfig_path, observe),
        );
        let root = projects.first().cloned().unwrap_or_else(|| {
            take(
                &mut facts,
                graph::normalize_path_consumed(tsconfig_path, observe),
            )
        });
        // Single proven leaf: all original ownership outcomes select this same root.
        let single_leaf = facts.qualified && projects.len() == 1;
        let mut owner = None;
        for project in projects {
            let ownership =
                self.project_owns_source_consumed(&project, source_path, source_kind, observe);
            let owns = if single_leaf {
                ownership.value
            } else {
                take(&mut facts, ownership)
            };
            if !owns {
                continue;
            }
            if owner.is_some() {
                return finish(facts, root);
            }
            owner = Some(project);
        }
        finish(facts, owner.unwrap_or(root))
    }
}

#[cfg(test)]
mod consumed_selection_tests;
