//! Exact topology helpers extracted from the original shadow owner.

use super::observed::ShadowFacts;
use super::workspace_dependencies::WorkspaceShadowPlan;
use super::{PackageShadowTopology, VirtualProject};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use vize_carton::{FxHashSet, cstr};

impl VirtualProject {
    pub(in super::super) fn collect_route_shadow_topology(
        &self,
        route: &crate::PackageRoute,
        shadow_root: &Path,
        ancestors: &mut FxHashSet<PathBuf>,
        topology: &mut PackageShadowTopology,
        plan: &WorkspaceShadowPlan,
        facts: &mut ShadowFacts,
    ) {
        if !ancestors.insert(route.manifest_path.clone()) {
            return;
        }
        topology.manifests.insert(
            shadow_root.join("package.json"),
            route.manifest_path.clone(),
        );
        self.collect_package_source_shadows(&route.package_root, shadow_root, topology, facts);
        self.collect_manifest_target_shadows(route, shadow_root, topology, facts);
        let mut nested_routes = route.nested_routes.iter().collect::<Vec<_>>();
        let private_dependencies = self.private_dependencies_for(&route.manifest_path);
        nested_routes.extend(private_dependencies.iter());
        nested_routes.sort_by(|left, right| left.manifest_path.cmp(&right.manifest_path));
        nested_routes.dedup();
        for nested in nested_routes {
            let Some(package_name) = nested.package_name.as_deref() else {
                continue;
            };
            self.collect_route_shadow_topology(
                nested,
                &shadow_root.join("node_modules").join(package_name),
                ancestors,
                topology,
                plan,
                facts,
            );
        }
        self.collect_workspace_dependency_shadows(
            route,
            shadow_root,
            ancestors,
            topology,
            plan,
            facts,
        );
        ancestors.remove(&route.manifest_path);
    }

    fn collect_manifest_target_shadows(
        &self,
        route: &crate::PackageRoute,
        shadow_root: &Path,
        topology: &mut PackageShadowTopology,
        facts: &mut ShadowFacts,
    ) {
        for source in &route.source_targets {
            let Some(canonical_virtual) = self
                .find_by_original(&source.source_path)
                .map(|file| file.virtual_path.clone())
            else {
                continue;
            };
            let Some(relative_probe) = source.native_probe_relative_path(&route.package_root)
            else {
                continue;
            };
            topology
                .files
                .entry(shadow_root.join(relative_probe))
                .or_insert_with(|| canonical_virtual.clone());
            if let Some(relative_target) =
                source.declaration_target_relative_path(&route.package_root)
            {
                topology
                    .files
                    .entry(shadow_root.join(relative_target))
                    .or_insert_with(|| canonical_virtual.clone());
            }
            self.collect_workspace_dependency_target_shadows(
                route,
                source,
                shadow_root,
                topology,
                facts,
            );
        }
    }

    fn collect_workspace_dependency_target_shadows(
        &self,
        route: &crate::PackageRoute,
        source: &crate::PackageRouteSource,
        shadow_root: &Path,
        topology: &mut PackageShadowTopology,
        facts: &mut ShadowFacts,
    ) {
        let normalized_root = facts.canonical(&route.package_root);
        let Some(indexed_sources) = self.package_source_index.get(&normalized_root) else {
            return;
        };
        let mut sources = indexed_sources
            .iter()
            .map(|(source_path, (_, virtual_path))| (source_path, virtual_path))
            .collect::<Vec<_>>();
        sources.sort_by(|left, right| left.0.cmp(right.0));

        for (dependency, canonical_virtual) in sources {
            let Some(relative_probe) =
                source.workspace_dependency_probe_relative_path(&route.package_root, dependency)
            else {
                continue;
            };
            topology
                .files
                .entry(shadow_root.join(relative_probe))
                .or_insert_with(|| canonical_virtual.clone());
        }
    }

    fn collect_package_source_shadows(
        &self,
        source_root: &Path,
        shadow_root: &Path,
        topology: &mut PackageShadowTopology,
        facts: &mut ShadowFacts,
    ) {
        let normalized_root = facts.canonical(source_root);
        let mut source_files = self
            .package_source_index
            .get(&normalized_root)
            .into_iter()
            .flatten()
            .map(|(_, (relative, virtual_path))| (relative.clone(), virtual_path.clone()))
            .collect::<Vec<_>>();
        source_files.sort_by(|left, right| left.0.cmp(&right.0));

        for (relative, canonical_virtual) in source_files {
            let destination = shadow_root.join(&relative);
            if relative
                .extension()
                .is_some_and(|extension| extension == "vue")
            {
                let Some(name) = destination.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                let suffix = if canonical_virtual
                    .extension()
                    .is_some_and(|extension| extension == "tsx")
                {
                    ".tsx"
                } else {
                    ".ts"
                };
                topology
                    .files
                    .entry(destination.with_file_name(cstr!("{name}{suffix}")))
                    .or_insert_with(|| canonical_virtual.clone());
                let stem = relative
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or(name);
                topology
                    .files
                    .entry(destination.with_file_name(cstr!("{stem}.d.vue.ts")))
                    .or_insert(canonical_virtual);
            } else {
                topology.files.insert(destination, canonical_virtual);
            }
        }
    }
}

pub(super) fn private_package_shadow_root(
    virtual_root: &Path,
    manifest_path: &Path,
    facts: &mut ShadowFacts,
) -> PathBuf {
    let manifest_path = facts.canonical(manifest_path);
    let mut digest = Sha256::new();
    digest.update(b"vize-private-package-shadow:v1\0");
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        digest.update(manifest_path.as_os_str().as_bytes());
    }
    #[cfg(not(unix))]
    digest.update(manifest_path.as_os_str().to_string_lossy().as_bytes());
    let mut key = vize_carton::String::with_capacity(64);
    for nibble in digest
        .finalize()
        .into_iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
    {
        if let Some(digit) = char::from_digit(u32::from(nibble), 16) {
            key.push(digit);
        }
    }
    virtual_root
        .join("__vize_package_scopes__")
        .join(key.as_str())
}
