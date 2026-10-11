//! Preserve real in-package install scopes inside workspace shadow copies.

use std::path::{Path, PathBuf};

use vize_carton::{FxHashMap, FxHashSet, String};

use super::observed::ShadowFacts;
use super::{PackageShadowTopology, VirtualProject};

type PackageIdentity = (PathBuf, PathBuf);

pub(super) struct WorkspaceShadowPlan {
    incoming: FxHashMap<PathBuf, FxHashSet<PackageIdentity>>,
    divergent: FxHashSet<String>,
}

fn identity(route: &crate::PackageRoute, facts: &mut ShadowFacts) -> PackageIdentity {
    (
        facts.canonical(&route.package_root),
        facts.canonical(&route.manifest_path),
    )
}

impl WorkspaceShadowPlan {
    pub(super) fn selected_install_shadow(
        &self,
        project: &VirtualProject,
        binding: &crate::PackageRouteBinding,
        facts: &mut ShadowFacts,
    ) -> Option<PathBuf> {
        let route = binding.route.as_ref()?;
        let name = route.package_name.as_deref()?;
        if binding.specifier.starts_with('#')
            || !route.workspace_source
            || !self.divergent.contains(name)
        {
            return None;
        }
        let owner = binding
            .importer_path
            .ancestors()
            .find(|path| project.package_route_roots.contains_key(*path))?;
        let relative = route.package_link_root.strip_prefix(owner).ok()?;
        if !relative.ends_with(Path::new("node_modules").join(name)) {
            return None;
        }
        // Rebase the actual selected installation, not each importing source
        // directory. Divergent packages keep their own physical identity.
        facts
            .mirrored(&project.project_root, &project.virtual_root, owner)
            .ok()
            .map(|root| root.join(relative))
    }

    fn target(
        &self,
        importer: &Path,
        name: &str,
        route: &crate::PackageRoute,
        alias: &Path,
        facts: &mut ShadowFacts,
    ) -> Option<PathBuf> {
        let expected = identity(route, facts);
        for directory in importer.parent()?.ancestors() {
            let candidate = directory.join("node_modules").join(name);
            let Some(identities) = self.incoming.get(&candidate) else {
                continue;
            };
            // The nearest visible root is authoritative, including a conflict.
            // A farther same-name package must not hide a divergent install.
            if identities.len() != 1
                || !identities.contains(&expected)
                || candidate.starts_with(alias)
                || alias.starts_with(&candidate)
            {
                return None;
            }
            return Some(candidate);
        }
        None
    }
}

impl VirtualProject {
    pub(super) fn workspace_shadow_plan(&self, facts: &mut ShadowFacts) -> WorkspaceShadowPlan {
        let mut identities = FxHashMap::<String, FxHashSet<_>>::default();
        for binding in self.package_routes.values() {
            if !binding.specifier.starts_with('#')
                && let Some(route) = binding.route.as_ref()
                && let Some(name) = route.package_name.as_ref()
            {
                facts.binding(binding);
                identities
                    .entry(name.clone())
                    .or_default()
                    .insert(identity(route, facts));
            }
        }
        let mut plan = WorkspaceShadowPlan {
            incoming: FxHashMap::default(),
            divergent: identities
                .into_iter()
                .filter_map(|(name, roots)| (roots.len() > 1).then_some(name))
                .collect(),
        };
        for binding in self.package_routes.values() {
            if binding.specifier.starts_with('#') {
                continue;
            }
            let Some(route) = binding.route.as_ref() else {
                continue;
            };
            let Some(name) = route.package_name.as_deref() else {
                continue;
            };
            let Some(directory) = self
                .find_by_original(&binding.importer_path)
                .and_then(|file| file.virtual_path.parent())
            else {
                continue;
            };
            facts.binding(binding);
            let roots = plan
                .selected_install_shadow(self, binding, facts)
                .map_or_else(
                    || {
                        self.package_shadow_scope_dirs(name, directory)
                            .into_iter()
                            .map(|scope| scope.join("node_modules").join(name))
                            .collect()
                    },
                    |root| vec![root],
                );
            for root in roots {
                plan.incoming
                    .entry(root)
                    .or_default()
                    .insert(identity(route, facts));
            }
        }
        facts.configuration();
        plan
    }

    pub(super) fn private_dependencies_for(&self, manifest: &Path) -> Vec<&crate::PackageRoute> {
        let mut routes = self
            .package_route_manifests
            .get(manifest)
            .into_iter()
            .flatten()
            .filter_map(|key| self.package_routes.get(key))
            .filter(|binding| binding.specifier.starts_with('#'))
            .filter_map(|binding| binding.route.as_ref())
            .flat_map(|route| route.nested_routes.iter())
            .collect::<Vec<_>>();
        routes.sort_by(|left, right| left.manifest_path.cmp(&right.manifest_path));
        routes.dedup();
        routes
    }

    pub(super) fn collect_workspace_dependency_shadows(
        &self,
        route: &crate::PackageRoute,
        shadow_root: &Path,
        ancestors: &mut FxHashSet<PathBuf>,
        topology: &mut PackageShadowTopology,
        plan: &WorkspaceShadowPlan,
        facts: &mut ShadowFacts,
    ) {
        if !route.workspace_source {
            return;
        }
        let root = facts.canonical(&route.package_root);
        let Some(sources) = self.package_source_index.get(&root) else {
            return;
        };
        let mut dependencies = Vec::new();
        for (source, (source_relative, _)) in sources {
            let Some(keys) = self.package_route_importers.get(source) else {
                continue;
            };
            for key in keys {
                let Some(binding) = self.package_routes.get(key) else {
                    continue;
                };
                // Private imports already retain their manifest-keyed topology.
                if binding.specifier.starts_with('#') {
                    continue;
                }
                let Some(dependency) = binding.route.as_ref() else {
                    continue;
                };
                let Some(name) = dependency.package_name.as_deref() else {
                    continue;
                };
                let Ok(relative) = dependency.package_link_root.strip_prefix(&root) else {
                    // A root/shared install already uses the common shadow
                    // scope. Inventing deeper copies splits class identity.
                    continue;
                };
                if !relative.ends_with(Path::new("node_modules").join(name)) {
                    continue;
                }
                let shadow = shadow_root.join(relative);
                let previous_owner = facts.binding(binding);
                let target = dependency
                    .workspace_source
                    .then(|| {
                        plan.target(
                            &shadow_root.join(source_relative),
                            name,
                            dependency,
                            &shadow,
                            facts,
                        )
                    })
                    .flatten();
                facts.restore_owner(previous_owner);
                dependencies.push((shadow, dependency, target));
            }
        }
        dependencies.sort_by(|(left, left_route, _), (right, right_route, _)| {
            (left, &left_route.manifest_path).cmp(&(right, &right_route.manifest_path))
        });
        dependencies.dedup();
        let mut remaining = dependencies.as_slice();
        while let Some((shadow, dependency, target)) = remaining.first() {
            let count = remaining.partition_point(|entry| entry.0 == *shadow);
            let Some((group, tail)) = remaining.split_at_checked(count) else {
                break;
            };
            let shared_target = target.as_ref().filter(|target| {
                group.iter().all(|(_, route, candidate)| {
                    identity(route, facts) == identity(dependency, facts)
                        && candidate.as_ref() == Some(*target)
                })
            });
            if let Some(target) = shared_target {
                topology.aliases.insert(shadow.clone(), target.clone());
                // Pin the target's authored files and raw manifest under this
                // owner too; another binding's refresh/removal cannot dangle it.
                self.collect_route_shadow_topology(
                    dependency, target, ancestors, topology, plan, facts,
                );
            } else {
                // An uncertain or divergent incoming scope retains the bound
                // installation's own topology rather than aliasing by name.
                for (_, route, _) in group {
                    self.collect_route_shadow_topology(
                        route, shadow, ancestors, topology, plan, facts,
                    );
                }
                if dependency.workspace_source
                    && topology.manifests.get(&shadow.join("package.json"))
                        == Some(&dependency.manifest_path)
                    && group
                        .iter()
                        .all(|(_, route, _)| identity(route, facts) == identity(dependency, facts))
                {
                    topology
                        .install_roots
                        .insert(shadow.clone(), dependency.manifest_path.clone());
                }
            }
            remaining = tail;
        }
    }
}
