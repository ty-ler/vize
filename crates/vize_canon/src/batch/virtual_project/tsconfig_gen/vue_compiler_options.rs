//! Flatten `vueCompilerOptions` the way `@vue/language-core` does: later
//! `extends` entries override earlier ones, then the extending file wins.
//!
//! `checkUnknownProps` defaults to `strictTemplates`, which defaults to false.
//! Isolated typecheck must follow that, or extras vue-tsc would ignore (vuestic
//! `:gradient`, voicevox `disable`) score as one-sided false positives.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use vize_carton::{FxHashMap, FxHashSet};

use crate::batch::error::CorsaResult;
use crate::package_route::stamp::{Consumed, InputStamp};
use crate::virtual_ts::ResolveStyleClassNames;

use super::super::VirtualProject;
use super::super::tsconfig_paths::{
    normalize_path_lexically, parse_jsonc_value, resolve_extended_tsconfig_path,
    resolve_extended_tsconfig_path_observed,
};

#[derive(Default)]
#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
struct ChainLoad {
    active: FxHashSet<PathBuf>,
    completed: FxHashMap<PathBuf, Map<std::string::String, Value>>,
    cycle_cut: bool,
    stamps: Vec<InputStamp>,
    unknown: bool,
    observe: bool,
}

impl ChainLoad {
    fn resolve_parent(&mut self, config: &Path, extends: &str) -> Option<PathBuf> {
        if !self.observe {
            return resolve_extended_tsconfig_path(config, extends);
        }
        let consumed = resolve_extended_tsconfig_path_observed(config, extends);
        self.unknown |= !consumed.qualified || consumed.value.is_none();
        self.stamps.extend(consumed.stamps);
        consumed.value
    }
}

mod refresh;

impl VirtualProject {
    #[cfg(test)]
    pub(crate) fn checks_unknown_props(&self) -> bool {
        self.virtual_ts_check_options.check_unknown_props
    }

    #[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
    fn load_vue_compiler_options(
        &self,
        tsconfig_path: Option<&Path>,
    ) -> CorsaResult<Map<std::string::String, Value>> {
        self.load_vue_compiler_options_consumed(tsconfig_path, false)
            .map(|consumed| consumed.value)
    }

    #[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
    pub(in super::super) fn load_vue_compiler_options_observed(
        &self,
        tsconfig_path: Option<&Path>,
    ) -> CorsaResult<Consumed<Map<std::string::String, Value>>> {
        self.load_vue_compiler_options_consumed(tsconfig_path, true)
    }

    #[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
    fn load_vue_compiler_options_consumed(
        &self,
        tsconfig_path: Option<&Path>,
        observe: bool,
    ) -> CorsaResult<Consumed<Map<std::string::String, Value>>> {
        let Some(tsconfig_path) = tsconfig_path else {
            return Ok(Consumed {
                value: Map::new(),
                stamps: Vec::new(),
                qualified: false,
            });
        };
        let mut load = ChainLoad {
            observe,
            unknown: observe && !tsconfig_path.is_absolute(),
            ..Default::default()
        };
        let value = self.load_vue_compiler_options_inner(tsconfig_path, &mut load)?;
        Ok(Consumed {
            value,
            stamps: load.stamps,
            qualified: !load.unknown,
        })
    }

    #[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
    fn load_vue_compiler_options_inner(
        &self,
        tsconfig_path: &Path,
        load: &mut ChainLoad,
    ) -> CorsaResult<Map<std::string::String, Value>> {
        let exists = tsconfig_path.exists();
        if load.observe {
            load.stamps.push(InputStamp::observed_exists(
                tsconfig_path.to_path_buf(),
                exists,
            ));
        }
        if !exists {
            load.unknown = true;
            return Ok(Map::new());
        }
        let normalized = normalize_path_lexically(tsconfig_path);
        if let Some(cached) = load.completed.get(&normalized) {
            return Ok(cached.clone());
        }
        if !load.active.insert(normalized.clone()) {
            load.unknown = true;
            load.cycle_cut = true;
            return Ok(Map::new());
        }
        let enclosing_cycle_cut = std::mem::replace(&mut load.cycle_cut, false);
        let flattened = self.merge_extended_vue_compiler_options(&normalized, load);
        load.active.remove(&normalized);
        let chain_cycle_cut = load.cycle_cut;
        load.cycle_cut = enclosing_cycle_cut || chain_cycle_cut;
        if !chain_cycle_cut && let Ok(flattened) = &flattened {
            load.completed.insert(normalized, flattened.clone());
        }
        flattened
    }

    #[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
    fn merge_extended_vue_compiler_options(
        &self,
        normalized: &Path,
        load: &mut ChainLoad,
    ) -> CorsaResult<Map<std::string::String, Value>> {
        let content = std::fs::read_to_string(normalized)?;
        if load.observe {
            load.stamps.push(InputStamp::observed_source(
                normalized.to_path_buf(),
                content.as_bytes(),
            ));
        }
        let config = parse_jsonc_value(&content)?;
        let current = config
            .get("vueCompilerOptions")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut inherited = Map::new();
        match config.get("extends") {
            Some(Value::String(extends)) => {
                if let Some(parent_path) = load.resolve_parent(normalized, extends) {
                    inherited = self.load_vue_compiler_options_inner(&parent_path, load)?;
                }
            }
            Some(Value::Array(entries)) => {
                for extends in entries.iter().filter_map(Value::as_str) {
                    if let Some(parent_path) = load.resolve_parent(normalized, extends) {
                        inherited.extend(self.load_vue_compiler_options_inner(&parent_path, load)?);
                    }
                }
            }
            _ => {}
        }
        inherited.extend(current);
        Ok(inherited)
    }
}

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
fn check_unknown_props_enabled(options: &Map<std::string::String, Value>) -> bool {
    if let Some(value) = options.get("checkUnknownProps").and_then(Value::as_bool) {
        return value;
    }
    options
        .get("strictTemplates")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests;
