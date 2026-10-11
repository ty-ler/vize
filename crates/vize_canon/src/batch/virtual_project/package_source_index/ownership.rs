use super::{FxHashMap, FxHashSet, PackageRouteKey, PathBuf, VirtualProject};

/// Exact registry values copied only after the original registration owner returns.
/// This transient value carries no filesystem/content freshness by itself.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RegisteredPackageRoots {
    bindings: FxHashMap<PackageRouteKey, crate::PackageRouteBinding>,
    roots: FxHashMap<PathBuf, FxHashSet<PackageRouteKey>>,
}

/// One existing source-regeneration scope, never a freshness grant by itself.
pub(crate) struct RegisteredPackageGeneration {
    pub(crate) roots: RegisteredPackageRoots,
    pub(crate) sources: FxHashSet<PathBuf>,
}

impl VirtualProject {
    pub(crate) fn snapshot_regenerated_package_generation(
        &self,
        sources: FxHashSet<PathBuf>,
    ) -> RegisteredPackageGeneration {
        RegisteredPackageGeneration {
            roots: self.snapshot_registered_package_roots(),
            sources,
        }
    }

    pub(in super::super) fn snapshot_registered_package_roots(&self) -> RegisteredPackageRoots {
        RegisteredPackageRoots {
            bindings: self.package_routes.clone(),
            roots: self.package_route_roots.clone(),
        }
    }

    pub(crate) fn registered_package_roots_are_current(
        &self,
        owner: &RegisteredPackageRoots,
    ) -> bool {
        self.package_routes == owner.bindings && self.package_route_roots == owner.roots
    }
}

#[expect(
    clippy::disallowed_macros,
    reason = "draft fixtures use std assertions"
)]
#[cfg(test)]
mod tests;
