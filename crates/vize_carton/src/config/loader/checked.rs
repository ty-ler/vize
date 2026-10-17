//! Fail closed on invalid discovered configuration for command execution.
use std::path::{Path, PathBuf};

use super::{
    LoadedRawConfig,
    discovery::{CONFIG_FILE_NAMES, CONFIG_MIGRATION, retired_config_paths, search_directories},
    parse::parse_raw_config_file_with_dependencies,
    project_defaults,
};

pub(super) fn load_raw_config_checked(
    path: Option<&Path>,
) -> Result<LoadedRawConfig, std::string::String> {
    load_raw_checked(path, true, &mut Vec::new())
}

/// An editor workspace directory can legitimately have no dedicated config.
pub(super) fn load_raw_editor_config_checked(
    path: Option<&Path>,
) -> Result<LoadedRawConfig, std::string::String> {
    load_raw_editor_config_attempt(path).outcome
}

/// Failed resolver observations are repair watches, never configuration values.
pub(super) struct EditorConfigAttempt {
    pub outcome: Result<LoadedRawConfig, std::string::String>,
    pub dependencies: Vec<PathBuf>,
}

pub(super) fn load_raw_editor_config_attempt(path: Option<&Path>) -> EditorConfigAttempt {
    let mut dependencies = Vec::new();
    let outcome = load_raw_checked(path, false, &mut dependencies);
    dependencies.sort();
    dependencies.dedup();
    EditorConfigAttempt {
        outcome,
        dependencies,
    }
}

fn load_raw_checked(
    path: Option<&Path>,
    require_explicit_config: bool,
    dependencies: &mut Vec<PathBuf>,
) -> Result<LoadedRawConfig, std::string::String> {
    let base = path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    dependencies.push(base.clone());
    if !base.exists() {
        return Err(crate::cstr!("config file not found: {}", base.display()).into());
    }
    if base.is_file() {
        return parse(&base, dependencies);
    }
    // The directory's children are the actual discovery inputs. Keeping its
    // mtime would turn unrelated source-file creation into config changes.
    dependencies.pop();
    for directory in search_directories(&base, path.is_none()) {
        for name in CONFIG_FILE_NAMES {
            let candidate = directory.join(name);
            dependencies.push(candidate.clone());
            if !candidate.exists() {
                continue;
            }
            match parse_raw_config_file_with_dependencies(&candidate, dependencies) {
                Ok(config) => {
                    return Ok(LoadedRawConfig {
                        config,
                        source_path: Some(candidate),
                    });
                }
                Err(error) => {
                    return Err(
                        crate::cstr!("failed to parse {}: {error}", candidate.display()).into(),
                    );
                }
            }
        }
        let retired = retired_config_paths(&directory);
        if !retired.is_empty() {
            dependencies.extend(retired);
            return Err(CONFIG_MIGRATION.into());
        }
    }
    if path.is_some() && require_explicit_config {
        return Err(crate::cstr!("no Vite config file found under {}", base.display()).into());
    }
    Ok(LoadedRawConfig {
        config: project_defaults(),
        source_path: None,
    })
}

fn parse(
    path: &Path,
    dependencies: &mut Vec<PathBuf>,
) -> Result<LoadedRawConfig, std::string::String> {
    parse_raw_config_file_with_dependencies(path, dependencies)
        .map(|config| LoadedRawConfig {
            config,
            source_path: Some(path.to_path_buf()),
        })
        .map_err(|error| crate::cstr!("failed to parse {}: {error}", path.display()).into())
}
