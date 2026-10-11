//! Effective package-resolution identity shared by batch and editor mirrors.
//!
//! This records cache identity only. Raw package manifests remain the sole
//! authority for target/condition selection inside TypeScript.

#![expect(clippy::disallowed_types, reason = "serde_json keys are std String")] // serde_json::Map keys are std::string::String.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::VirtualProject;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct PackageResolutionSettings {
    options: Map<String, Value>,
    config_paths: Vec<PathBuf>,
}

impl VirtualProject {
    pub(crate) fn package_resolution_settings(&self) -> PackageResolutionSettings {
        self.package_resolution_settings_consumed(false).value
    }

    pub(crate) fn package_resolution_settings_observed(
        &self,
    ) -> crate::package_route::stamp::Consumed<PackageResolutionSettings> {
        self.package_resolution_settings_consumed(true)
    }

    pub(crate) fn package_resolution_settings_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<PackageResolutionSettings> {
        use super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let path = take(&mut facts, self.resolved_tsconfig_path_consumed(observe));
        let options = self
            .configuration_options(path.as_deref(), observe, &mut facts)
            .unwrap_or_default();
        let config_paths = take(&mut facts, self.governing_config_paths_consumed(observe));
        finish(
            facts,
            PackageResolutionSettings {
                options,
                config_paths,
            },
        )
    }
}

impl PackageResolutionSettings {
    pub(crate) fn context(
        &self,
        resolver: &mut crate::PackageRouteResolver,
        importer: &Path,
        occurrence_mode: crate::PackageResolutionMode,
    ) -> (crate::PackageResolutionContext, Vec<PathBuf>) {
        context_from_options(resolver, importer, occurrence_mode, &self.options)
    }

    pub(crate) fn context_observed(
        &self,
        resolver: &mut crate::PackageRouteResolver,
        importer: &Path,
        occurrence_mode: crate::PackageResolutionMode,
    ) -> crate::package_route::stamp::Consumed<(crate::PackageResolutionContext, Vec<PathBuf>)>
    {
        let mut consumed = self.context_consumed(resolver, importer, occurrence_mode, true);
        // A bare settings value has discarded the original compiler/governing authority.
        consumed.qualified = false;
        consumed
    }

    pub(crate) fn context_with_configuration_observed(
        settings: &crate::package_route::stamp::Consumed<Self>,
        resolver: &mut crate::PackageRouteResolver,
        importer: &Path,
        occurrence_mode: crate::PackageResolutionMode,
    ) -> crate::package_route::stamp::Consumed<(crate::PackageResolutionContext, Vec<PathBuf>)>
    {
        use super::project::consumption::{finish, take};
        let mut facts = crate::package_route::stamp::Consumed {
            value: (),
            stamps: settings.stamps.clone(),
            qualified: settings.qualified,
        };
        let value = take(
            &mut facts,
            settings
                .value
                .context_consumed(resolver, importer, occurrence_mode, true),
        );
        finish(facts, value)
    }

    pub(super) fn context_consumed(
        &self,
        resolver: &mut crate::PackageRouteResolver,
        importer: &Path,
        occurrence_mode: crate::PackageResolutionMode,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<(crate::PackageResolutionContext, Vec<PathBuf>)>
    {
        context_from_options_consumed(resolver, importer, occurrence_mode, &self.options, observe)
    }

    pub(crate) fn input_paths(&self) -> &[PathBuf] {
        &self.config_paths
    }
}

fn context_from_options(
    resolver: &mut crate::PackageRouteResolver,
    importer: &Path,
    occurrence_mode: crate::PackageResolutionMode,
    options: &Map<String, Value>,
) -> (crate::PackageResolutionContext, Vec<PathBuf>) {
    context_from_options_consumed(resolver, importer, occurrence_mode, options, false).value
}

fn context_from_options_consumed(
    resolver: &mut crate::PackageRouteResolver,
    importer: &Path,
    occurrence_mode: crate::PackageResolutionMode,
    options: &Map<String, Value>,
    observe: bool,
) -> crate::package_route::stamp::Consumed<(crate::PackageResolutionContext, Vec<PathBuf>)> {
    let module_resolution = option_string(options, "moduleResolution");
    let module = option_string(options, "module");
    let conditions = options
        .get("customConditions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);
    if observe {
        resolver.resolution_context_observed(
            importer,
            occurrence_mode,
            module_resolution.as_deref(),
            module.as_deref(),
            conditions,
        )
    } else {
        crate::package_route::stamp::Consumed {
            value: resolver.resolution_context(
                importer,
                occurrence_mode,
                module_resolution.as_deref(),
                module.as_deref(),
                conditions,
            ),
            stamps: Vec::new(),
            qualified: false,
        }
    }
}

fn option_string(options: &Map<String, Value>, name: &str) -> Option<String> {
    options
        .get(name)
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::context_from_options;
    use crate::PackageResolutionMode;

    #[test]
    fn records_flattened_conditions_and_contextual_importer_mode() {
        let options = serde_json::json!({
            "moduleResolution": "NodeNext",
            "customConditions": ["browser", "development"]
        })
        .as_object()
        .unwrap()
        .clone();
        let (context, _) = context_from_options(
            &mut crate::PackageRouteResolver::default(),
            std::path::Path::new("/workspace/src/index.cts"),
            PackageResolutionMode::Contextual,
            &options,
        );
        assert_eq!(context.module_resolution.as_deref(), Some("nodenext"));
        assert_eq!(context.mode, PackageResolutionMode::Require);
        assert_eq!(context.active_conditions, vec!["browser", "development"]);
    }

    #[test]
    fn infers_node_resolution_from_the_effective_module_option() {
        let options = serde_json::json!({ "module": "NodeNext" })
            .as_object()
            .unwrap()
            .clone();
        let (context, _) = context_from_options(
            &mut crate::PackageRouteResolver::default(),
            std::path::Path::new("/workspace/src/index.ts"),
            PackageResolutionMode::Contextual,
            &options,
        );

        assert_eq!(context.module_resolution.as_deref(), Some("nodenext"));
        assert_eq!(context.mode, PackageResolutionMode::Require);
    }

    #[test]
    fn records_preserve_module_as_effective_bundler_resolution() {
        let options = serde_json::json!({ "module": "Preserve" })
            .as_object()
            .unwrap()
            .clone();
        let (context, _) = context_from_options(
            &mut crate::PackageRouteResolver::default(),
            std::path::Path::new("/workspace/src/index.cts"),
            PackageResolutionMode::Contextual,
            &options,
        );

        assert_eq!(context.module_resolution.as_deref(), Some("bundler"));
        assert_eq!(context.mode, PackageResolutionMode::Require);
    }
}

#[cfg(test)]
mod consumed_package_settings_tests;
