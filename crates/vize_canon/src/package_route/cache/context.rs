//! Original occurrence context with operation-local consumed manifest facts.

use super::super::stamp::Consumed;
use super::{PackageResolutionContext, PackageRouteResolver};
use std::path::{Path, PathBuf};
use vize_carton::String;

impl PackageRouteResolver {
    pub(crate) fn resolution_context_observed(
        &mut self,
        importer: &Path,
        occurrence_mode: super::super::PackageResolutionMode,
        module_resolution: Option<&str>,
        module: Option<&str>,
        active_conditions: impl IntoIterator<Item = impl Into<String>>,
    ) -> Consumed<(PackageResolutionContext, Vec<PathBuf>)> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut inputs = Vec::new();
        let start = importer.parent().unwrap_or(importer);
        let consumed = super::super::search::nearest_package_manifest_observed(
            start,
            &mut inputs,
            &mut state.search,
        );
        let nearest_scope = consumed.value;
        let package_is_module = nearest_scope.as_ref().map(|(_, manifest)| {
            manifest.get("type").and_then(serde_json::Value::as_str) == Some("module")
        });
        let mut context = PackageResolutionContext::for_importer(
            importer,
            occurrence_mode,
            module_resolution,
            module,
            active_conditions,
            package_is_module,
        );
        context.scope_manifest_path = nearest_scope.map(|(root, _)| root.join("package.json"));
        Consumed {
            value: (context, inputs),
            stamps: consumed.stamps,
            qualified: importer.is_absolute() && consumed.qualified,
        }
    }
}
