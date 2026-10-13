//! Original bounded package-specifier frontier, moved without behavior changes.

use std::path::{Path, PathBuf};
use crate::batch::virtual_project::VirtualProject;
use vize_carton::String as CompactString;

pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn package_specifiers_from_frontier(
    project: &VirtualProject,
    scanned: &mut vize_carton::FxHashSet<PathBuf>,
) -> Vec<CompactString> {
    let rewriter = crate::batch::ImportRewriter::new();
    let mut specifiers = project
        .virtual_files_sorted()
        .into_iter()
        .filter(|file| scanned.insert(file.original_path.clone()))
        .flat_map(|file| {
            let source_type = if file
                .virtual_path
                .extension()
                .is_some_and(|extension| extension == "tsx")
            {
                oxc_span::SourceType::tsx()
            } else {
                oxc_span::SourceType::ts()
            };
            rewriter.collect_all_specifiers(&file.content, source_type)
        })
        .filter(|specifier| {
            !specifier.starts_with('.') && !Path::new(specifier.as_str()).is_absolute()
        })
        .collect::<Vec<_>>();
    specifiers.sort();
    specifiers.dedup();
    specifiers
}
