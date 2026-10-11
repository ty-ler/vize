//! Literal owned binding and private-route operations used as complete controls.
use super::super::topology::private_package_shadow_root;
use super::super::workspace_dependencies::WorkspaceShadowPlan;
use super::super::{CorsaResult, FxHashSet, PackageShadowTopology, ShadowFacts, VirtualProject};
use crate::package_route::{PackageRouteKey, stamp::Consumed};
use std::path::Path;

// Literal original clone operations remain separate complete controls.
impl VirtualProject {
    pub(super) fn original_rebuild_package_shadows(
        &mut self,
        observe: bool,
    ) -> CorsaResult<Consumed<()>> {
        let mut facts = ShadowFacts::new(self, observe);
        if !self.package_shadows_initialized {
            self.package_shadow_files.clear();
            self.package_shadow_manifests.clear();
            self.package_shadow_artifacts.clear();
            self.package_shadow_file_owners.clear();
            self.package_shadow_manifest_owners.clear();
            self.package_shadow_source_paths.clear();
            self.package_shadow_dirty_keys
                .extend(self.package_routes.keys().cloned());
            self.package_shadows_initialized = true;
        }

        self.refresh_package_shadow_scopes(&mut facts);
        let plan = self.workspace_shadow_plan(&mut facts);
        let mut dirty = std::mem::take(&mut self.package_shadow_dirty_keys)
            .into_iter()
            .collect::<Vec<_>>();
        dirty.sort();
        self.incremental_shadow_bindings_rebuilt += dirty.len();
        for key in dirty {
            self.original_refresh_package_shadow(&key, &plan, &mut facts)?;
        }
        Ok(facts.finish())
    }

    fn original_refresh_package_shadow(
        &mut self,
        key: &PackageRouteKey,
        plan: &WorkspaceShadowPlan,
        facts: &mut ShadowFacts,
    ) -> CorsaResult<()> {
        self.remove_package_shadow_owner(key);
        let Some(binding) = self.package_routes.get(key).cloned() else {
            return Ok(());
        };
        let Some(route) = binding.route.as_ref() else {
            return Ok(());
        };
        facts.binding(&binding);
        let mut topology = PackageShadowTopology::default();

        if let Some(scope_manifest) = binding.context.scope_manifest_path.as_ref()
            && facts.is_file(scope_manifest)
            && let Ok(virtual_manifest) =
                facts.mirrored(&self.project_root, &self.virtual_root, scope_manifest)
        {
            topology
                .manifests
                .insert(virtual_manifest, scope_manifest.clone());
        }

        // Declaration emit uses Canon's canonical materialized identities.
        // Give them the same native package boundary/probes as importer roots.
        if let Ok(canonical_root) =
            facts.mirrored(&self.project_root, &self.virtual_root, &route.package_root)
        {
            self.collect_route_shadow_topology(
                route,
                &canonical_root,
                &mut FxHashSet::default(),
                &mut topology,
                plan,
                facts,
            );
        }

        if let Some(importer_virtual_path) = self
            .find_by_original(&binding.importer_path)
            .map(|file| file.virtual_path.clone())
        {
            let shadow_roots = if binding.specifier.starts_with('#') {
                vec![private_package_shadow_root(
                    &self.virtual_root,
                    &route.manifest_path,
                    facts,
                )]
            } else if let Some(root) = plan.selected_install_shadow(self, &binding, facts) {
                topology
                    .install_roots
                    .insert(root.clone(), route.manifest_path.clone());
                vec![root]
            } else if let (Some(package_name), Some(importer_dir)) = (
                route.package_name.as_deref(),
                importer_virtual_path.parent(),
            ) {
                self.package_shadow_scope_dirs(package_name, importer_dir)
                    .into_iter()
                    .map(|scope| scope.join("node_modules").join(package_name))
                    .collect()
            } else {
                self.install_package_shadow_owner(key.clone(), topology);
                return Ok(());
            };
            for shadow_root in shadow_roots {
                self.collect_route_shadow_topology(
                    route,
                    &shadow_root,
                    &mut FxHashSet::default(),
                    &mut topology,
                    plan,
                    facts,
                );
            }
        }
        self.install_package_shadow_owner(key.clone(), topology);
        Ok(())
    }

    pub(super) fn original_private_dependencies_for(
        &self,
        manifest: &Path,
    ) -> Vec<crate::PackageRoute> {
        let mut routes = self
            .package_route_manifests
            .get(manifest)
            .into_iter()
            .flatten()
            .filter_map(|key| self.package_routes.get(key))
            .filter(|binding| binding.specifier.starts_with('#'))
            .filter_map(|binding| binding.route.as_ref())
            .flat_map(|route| route.nested_routes.iter().cloned())
            .collect::<Vec<_>>();
        routes.sort_by(|left, right| left.manifest_path.cmp(&right.manifest_path));
        routes.dedup();
        routes
    }
}
