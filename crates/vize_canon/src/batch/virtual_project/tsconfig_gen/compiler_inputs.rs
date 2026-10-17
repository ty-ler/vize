//! Consistent inputs for one compiler-configuration capture.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use serde_json::Value;
use vize_carton::{FxHashMap, profile};

use crate::batch::error::{CorsaError, CorsaResult};
use crate::package_route::stamp::InputStamp;

use super::super::tsconfig_paths::{normalize_path_lexically, parse_jsonc_value};

#[derive(Eq, Hash, PartialEq)]
struct ResolutionKey {
    kind: &'static str,
    origin: PathBuf,
    specifier: vize_carton::String,
}

#[derive(Default)]
pub(in super::super) struct CompilerInputs {
    parsed: RefCell<FxHashMap<PathBuf, Value>>,
    content: RefCell<FxHashMap<PathBuf, vize_carton::String>>,
    observations: RefCell<FxHashMap<PathBuf, InputStamp>>,
    parsed_observations: RefCell<Vec<InputStamp>>,
    resolutions: RefCell<FxHashMap<ResolutionKey, Option<PathBuf>>>,
}

impl CompilerInputs {
    pub(in super::super) fn observe(&self, path: &Path) {
        let path = normalize_path_lexically(path);
        self.observations
            .borrow_mut()
            .entry(path.clone())
            .or_insert_with(|| InputStamp::capture(&path));
        // Package resolution follows links in ancestors, not just the final file.
        for ancestor in path.ancestors().skip(1) {
            if std::fs::symlink_metadata(ancestor)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                self.observations
                    .borrow_mut()
                    .entry(ancestor.to_path_buf())
                    .or_insert_with(|| InputStamp::capture(ancestor));
            }
        }
    }

    pub(in super::super) fn read_jsonc(&self, path: &Path) -> CorsaResult<Value> {
        let path = normalize_path_lexically(path);
        if let Some(parsed) = self.parsed.borrow().get(&path) {
            return Ok(parsed.clone());
        }
        let content = self.read_content(&path)?;
        let parsed = profile!("canon.tsconfig.parse", parse_jsonc_value(&content))?;
        self.parsed.borrow_mut().insert(path, parsed.clone());
        Ok(parsed)
    }

    fn read_content(&self, path: &Path) -> CorsaResult<vize_carton::String> {
        if let Some(content) = self.content.borrow().get(path) {
            return Ok(content.clone());
        }
        self.observe(path);
        let content =
            profile!("canon.tsconfig.read", std::fs::read_to_string(path)).map_err(|error| {
                CorsaError::Configuration(vize_carton::cstr!(
                    "cannot read tsconfig {}: {error}",
                    path.display()
                ))
            })?;
        self.parsed_observations
            .borrow_mut()
            .push(InputStamp::capture_source(path, content.as_bytes()));
        let content = vize_carton::String::from(content);
        self.content
            .borrow_mut()
            .insert(path.to_path_buf(), content.clone());
        Ok(content)
    }

    pub(in super::super) fn resolve(
        &self,
        kind: &'static str,
        origin: &Path,
        specifier: &str,
        resolve: impl FnOnce() -> Option<PathBuf>,
    ) -> Option<PathBuf> {
        let key = ResolutionKey {
            kind,
            origin: normalize_path_lexically(origin),
            specifier: vize_carton::String::from(specifier),
        };
        if let Some(resolved) = self.resolutions.borrow().get(&key) {
            return resolved.clone();
        }
        let resolved = resolve();
        self.resolutions.borrow_mut().insert(key, resolved.clone());
        resolved
    }

    pub(in super::super) fn installed_vue_manifest(
        &self,
        directory: &Path,
    ) -> Option<(PathBuf, Value)> {
        let path = self.resolve("package", directory, "vue", || {
            crate::package_route::installed_package_manifest_with_reader(
                directory,
                "vue",
                |path| {
                    self.read_content(path)
                        .ok()
                        .and_then(|content| serde_json::from_str(&content).ok())
                },
                |path| self.observe(path),
            )
            .map(|(path, _)| path)
        })?;
        let manifest = serde_json::from_str(&self.read_content(&path).ok()?).ok()?;
        Some((path, manifest))
    }

    pub(in super::super) fn validate(&self) -> CorsaResult<()> {
        if self
            .observations
            .borrow()
            .values()
            .all(InputStamp::is_current)
            && self
                .parsed_observations
                .borrow()
                .iter()
                .all(InputStamp::is_current)
        {
            return Ok(());
        }
        Err(CorsaError::Configuration(vize_carton::cstr!(
            "compiler configuration changed while it was being read; retry after the configuration is stable"
        )))
    }

    pub(in super::super) fn paths(&self) -> Vec<PathBuf> {
        self.observations.borrow().keys().cloned().collect()
    }
}

pub(in super::super) fn read_jsonc(
    path: &Path,
    inputs: Option<&CompilerInputs>,
) -> CorsaResult<Value> {
    if let Some(inputs) = inputs {
        return inputs.read_jsonc(path);
    }
    let content =
        profile!("canon.tsconfig.read", std::fs::read_to_string(path)).map_err(|error| {
            CorsaError::Configuration(vize_carton::cstr!(
                "cannot read tsconfig {}: {error}",
                path.display()
            ))
        })?;
    profile!("canon.tsconfig.parse", parse_jsonc_value(&content))
}
