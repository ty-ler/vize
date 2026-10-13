//! Original bounded package-specifier frontier, moved without behavior changes.

use crate::batch::virtual_project::{VirtualProject, dependency_scan::ParsedDependencySources};
use std::path::{Path, PathBuf};
use vize_carton::{FxHashSet, String as CompactString};

#[derive(Default, Debug, Eq, PartialEq)]
struct ParserWork {
    original_calls: usize,
    actual_calls: usize,
    exact_hits: usize,
}

pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn package_specifiers_from_frontier(
    project: &VirtualProject,
    scanned: &mut vize_carton::FxHashSet<PathBuf>,
    parsed: Option<&ParsedDependencySources>,
) -> Vec<CompactString> {
    let rewriter = crate::batch::ImportRewriter::new();
    let mut work = ParserWork::default();
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
            collect_specifiers(
                &rewriter,
                &file.virtual_path,
                &file.content,
                source_type,
                parsed,
                &mut work,
            )
        })
        .filter(|specifier| {
            !specifier.starts_with('.') && !Path::new(specifier.as_str()).is_absolute()
        })
        .collect::<Vec<_>>();
    specifiers.sort();
    specifiers.dedup();
    crate::corsa_bridge::preparation_trace::Phase::frontier_parser_work(
        work.original_calls,
        work.actual_calls,
        work.exact_hits,
    );
    specifiers
}

fn collect_specifiers(
    rewriter: &crate::batch::ImportRewriter,
    path: &Path,
    source: &str,
    source_type: oxc_span::SourceType,
    parsed: Option<&ParsedDependencySources>,
    work: &mut ParserWork,
) -> Vec<CompactString> {
    work.original_calls += 1;
    if let Some(occurrences) =
        parsed.and_then(|parsed| parsed.current_occurrences(path, source, source_type))
    {
        work.exact_hits += 1;
        let mut seen = FxHashSet::default();
        return occurrences
            .iter()
            .filter(|(specifier, _)| seen.insert(specifier.as_str()))
            .map(|(specifier, _)| specifier.clone())
            .collect();
    }
    work.actual_calls += 1;
    rewriter.collect_all_specifiers(source, source_type)
}

#[cfg(test)]
mod tests;
