//! Public wrappers retain the original dependency walk and result.
use super::super::package_source_index::RegisteredPackageRoots;
use super::{DependencyConsumption, ObservedPackageResolver, PackageResolver, VirtualProject};
use crate::batch::error::CorsaResult;
use crate::package_route::stamp::Consumed;
use std::path::PathBuf;
use vize_carton::{FxHashMap, String as CompactString};
impl VirtualProject {
    /// Register every reachable first-party dependency, to a fixpoint.
    pub fn register_reachable_dependencies(&mut self) -> CorsaResult<()> {
        self.register_reachable_dependencies_with_overlays(&FxHashMap::default())
    }

    /// Reconcile only dependencies reachable from sources rebuilt by one
    /// persistent patch. Existing edge ownership covers the untouched graph.
    pub(crate) fn register_reachable_dependencies_from(
        &mut self,
        sources: &[PathBuf],
    ) -> CorsaResult<()> {
        self.register_reachable_dependencies_inner(Some(sources), &FxHashMap::default(), &[], None)
    }

    /// The same walk, with unsaved editor buffers standing in for their on-disk
    /// contents.
    ///
    /// An editor session must see the buffer the user is typing in: a dependency
    /// reachable only through an import that exists in an unsaved file is
    /// invisible to a disk-only walk, so nothing registers it, its mirror
    /// companion is never generated, and the alias rewrite has no real file to
    /// point at until the buffer is saved (#3900).
    pub(crate) fn register_reachable_dependencies_with_overlays(
        &mut self,
        overlays: &FxHashMap<PathBuf, &str>,
    ) -> CorsaResult<()> {
        self.register_reachable_dependencies_inner(None, overlays, &[], None)
    }

    pub(crate) fn register_reachable_dependencies_with_package_resolver(
        &mut self,
        overlays: &FxHashMap<PathBuf, &str>,
        workspace_package_specifiers: &[CompactString],
        package_resolver: PackageResolver<'_>,
    ) -> CorsaResult<()> {
        self.register_reachable_dependencies_inner(
            None,
            overlays,
            workspace_package_specifiers,
            Some(package_resolver),
        )
    }

    /// Conditional native metadata from that same original frontier operation.
    /// Aliases must already carry the facts from their original load.
    #[cfg(test)]
    #[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
    pub(crate) fn register_reachable_dependencies_from_consumed(
        &mut self,
        sources: &[PathBuf],
        aliases: Consumed<Vec<(std::string::String, std::string::String)>>,
    ) -> CorsaResult<Consumed<Vec<PathBuf>>> {
        self.register_reachable_dependencies_consumed_inner(
            Some(sources),
            &FxHashMap::default(),
            &[],
            None,
            DependencyConsumption {
                aliases: Some(aliases),
                resolver: None,
                registered_roots: None,
            },
        )
    }
    /// Observe the same original full walk, including its fresh alias load and
    /// exactly one existing package callback per unresolved occurrence.
    pub(crate) fn register_reachable_dependencies_with_package_resolver_observed(
        &mut self,
        overlays: &FxHashMap<PathBuf, &str>,
        workspace_package_specifiers: &[CompactString],
        package_resolver: ObservedPackageResolver<'_>,
        registered_roots: Option<
            &Consumed<super::super::package_source_index::RegisteredPackageRoots>,
        >,
    ) -> CorsaResult<Consumed<Vec<PathBuf>>> {
        let aliases = self.dependency_alias_map_observed();
        self.register_reachable_dependencies_consumed_inner(
            None,
            overlays,
            workspace_package_specifiers,
            None,
            DependencyConsumption {
                aliases: Some(aliases),
                resolver: Some(package_resolver),
                registered_roots,
            },
        )
    }

    /// Observe the existing scoped walk with its full authoritative overlays
    /// and facts from the actual package callback and registered roots.
    pub(crate) fn register_reachable_dependencies_from_with_package_resolver_observed(
        &mut self,
        sources: &[PathBuf],
        overlays: &FxHashMap<PathBuf, &str>,
        workspace_package_specifiers: &[CompactString],
        package_resolver: ObservedPackageResolver<'_>,
        registered_roots: Option<&Consumed<RegisteredPackageRoots>>,
    ) -> CorsaResult<Consumed<Vec<PathBuf>>> {
        let aliases = self.dependency_alias_map_observed();
        self.register_reachable_dependencies_consumed_inner(
            Some(sources),
            overlays,
            workspace_package_specifiers,
            None,
            DependencyConsumption {
                aliases: Some(aliases),
                resolver: Some(package_resolver),
                registered_roots,
            },
        )
    }
}
