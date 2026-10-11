//! Authority retained by one original dependency walk.

use super::ObservedPackageResolver;

#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
pub(super) struct DependencyConsumption<'a> {
    pub(super) aliases: Option<
        crate::package_route::stamp::Consumed<Vec<(std::string::String, std::string::String)>>,
    >,
    pub(super) resolver: Option<ObservedPackageResolver<'a>>,
    pub(super) registered_roots: Option<
        &'a crate::package_route::stamp::Consumed<
            super::super::package_source_index::RegisteredPackageRoots,
        >,
    >,
    pub(super) parsed_sources: Option<&'a mut super::ParsedDependencySources>,
}

pub(super) fn occurrences(
    parsed: Option<&mut super::ParsedDependencySources>,
    rewriter: &crate::batch::ImportRewriter,
    path: &std::path::Path,
    source: &str,
    source_type: oxc_span::SourceType,
) -> Vec<(vize_carton::String, crate::PackageResolutionMode)> {
    match parsed {
        Some(parsed) => parsed.occurrences(rewriter, path, source, source_type),
        None => rewriter.collect_all_specifier_occurrences(source, source_type),
    }
}

pub(super) fn source_type(path: &std::path::Path) -> oxc_span::SourceType {
    if path.extension().is_some_and(|extension| extension == "tsx") {
        oxc_span::SourceType::tsx()
    } else {
        oxc_span::SourceType::ts()
    }
}
