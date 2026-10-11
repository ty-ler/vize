use super::super::{VirtualProject, project_virtual_root};
use crate::batch::error::CorsaResult;
use crate::batch::import_rewriter::ImportRewriter;
use crate::virtual_ts::{VirtualTsCheckOptions, VirtualTsOptions};
use std::path::Path;
use vize_atelier_core::TemplateSyntaxMode;
use vize_carton::{FxHashMap, FxHashSet};

impl VirtualProject {
    /// Create a new virtual project.
    pub fn new(project_root: &Path) -> CorsaResult<Self> {
        Self::new_consumed(project_root, false, true).map(|consumed| consumed.value)
    }

    #[cfg(test)]
    pub(crate) fn new_observed(
        project_root: &Path,
    ) -> CorsaResult<crate::package_route::stamp::Consumed<Self>> {
        Self::new_consumed(project_root, true, true)
    }

    /// Only original constructor configuration inputs, before graph/session ownership.
    /// Its initial virtual_root is overwritten by the native namespace operation.
    pub(crate) fn new_configuration_observed(
        project_root: &Path,
    ) -> CorsaResult<crate::package_route::stamp::Consumed<Self>> {
        Self::new_consumed(project_root, true, false)
    }

    fn new_consumed(
        project_root: &Path,
        observe: bool,
        complete_owner_gate: bool,
    ) -> CorsaResult<crate::package_route::stamp::Consumed<Self>> {
        let mut facts = super::consumption::empty(observe);
        let project_root = super::consumption::take(
            &mut facts,
            Self::canonical_configuration_path(project_root, observe),
        );
        let virtual_root = project_virtual_root(&project_root);

        let mut project = Self {
            project_root,
            virtual_root,
            tsconfig_path: None,
            preserve_unused_diagnostics: false,
            source_policy: Default::default(),
            alias_rewrite_policy: Default::default(),
            virtual_ts_options: VirtualTsOptions::default(),
            diagnostic_paths: FxHashSet::default(),
            declaration_roots: None,
            virtual_ts_check_options: VirtualTsCheckOptions::default(),
            typed_router: Default::default(),
            package_routes: FxHashMap::default(),
            package_route_reverse: FxHashMap::default(),
            package_route_importers: FxHashMap::default(),
            package_route_source_owners: FxHashMap::default(),
            package_route_manifests: FxHashMap::default(),
            package_route_roots: FxHashMap::default(),
            package_source_index: FxHashMap::default(),
            dependency_edges: FxHashMap::default(),
            dependency_inbound: FxHashMap::default(),
            package_route_resolver: Default::default(),
            package_routes_need_refresh: false,
            package_route_refresh_keys: FxHashSet::default(),
            package_shadow_files: FxHashMap::default(),
            package_shadow_manifests: FxHashMap::default(),
            package_shadow_artifacts: FxHashMap::default(),
            retired_package_shadow_paths: FxHashSet::default(),
            package_shadow_file_owners: FxHashMap::default(),
            package_shadow_manifest_owners: FxHashMap::default(),
            package_shadow_source_paths: FxHashMap::default(),
            package_shadow_dirty_keys: FxHashSet::default(),
            package_shadows_initialized: false,
            package_shadow_scopes: FxHashMap::default(),
            incremental_materialized_candidates: FxHashSet::default(),
            incremental_source_nodes_rebuilt: 0,
            incremental_dependency_nodes_reconciled: 0,
            incremental_shadow_bindings_rebuilt: 0,
            materialized_package_links: FxHashMap::default(),
            materialized_package_link_scopes: FxHashMap::default(),
            materialized_package_link_owners: FxHashMap::default(),
            package_link_scope_files: FxHashMap::default(),
            package_link_scope_targets: FxHashMap::default(),
            package_shadow_link_scopes: FxHashMap::default(),
            incremental_package_link_scopes: FxHashSet::default(),
            incremental_link_topology_dirty: false,
            options_api: false,
            session_scripts: false,
            editor_document_options: None,
            pre_rewrite_code: FxHashMap::default(),
            legacy_vue2: false,
            jsx_typecheck: false,
            dialect: vize_carton::config::VueVersion::default(),
            template_syntax: TemplateSyntaxMode::default(),
            experimental_in_tag_comments: false,
            experimental_patterned_template: false,
            experimental_strict_slot_children: false,
            virtual_files: FxHashMap::default(),
            shared_helper_source_count: 0,
            source_artifacts: FxHashMap::default(),
            passthrough_files: FxHashMap::default(),
            original_index: FxHashMap::default(),
            original_contents: FxHashMap::default(),
            unchecked_javascript_files: FxHashSet::default(),
            diagnostics: Vec::new(),
            rewriter: ImportRewriter::new(),
        };
        project.preserve_unused_diagnostics = super::consumption::take(
            &mut facts,
            project.resolve_tsconfig_preserves_unused_diagnostics_consumed(observe),
        );
        project.source_policy = super::consumption::take(
            &mut facts,
            project.resolve_source_file_policy_consumed(observe),
        );
        project.alias_rewrite_policy = super::consumption::take(
            &mut facts,
            project.resolve_alias_rewrite_policy_consumed(observe),
        );
        // Virtual root / session / environment owner authority is not a file fact.
        if complete_owner_gate {
            facts.qualified = false;
        }
        Ok(super::consumption::finish(facts, project))
    }
}

#[cfg(test)]
mod configuration_scope_tests;
