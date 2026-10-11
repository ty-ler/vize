use std::path::{Path, PathBuf};

use serde_json::Value;
use vize_carton::FxHashSet;

use super::{normalize_path_lexically, parse_jsonc_value};

pub(super) fn collect_project_paths(tsconfig_path: &Path) -> Vec<PathBuf> {
    collect_project_paths_consumed(tsconfig_path, false).value
}

pub(super) fn collect_project_paths_consumed(
    tsconfig_path: &Path,
    observe: bool,
) -> crate::package_route::stamp::Consumed<Vec<PathBuf>> {
    use super::super::super::project::consumption::{empty, finish};
    let mut paths = Vec::new();
    let mut seen = FxHashSet::default();
    let mut facts = empty(observe && tsconfig_path.is_absolute());
    collect_inner_consumed(tsconfig_path, &mut seen, &mut paths, observe, &mut facts);
    // A graph with unresolved entries is never a proven leaf merely by count.
    facts.qualified &= paths.len() == 1;
    finish(facts, paths)
}

fn collect_inner_consumed(
    tsconfig_path: &Path,
    seen: &mut FxHashSet<PathBuf>,
    paths: &mut Vec<PathBuf>,
    observe: bool,
    facts: &mut crate::package_route::stamp::Consumed<()>,
) {
    use super::super::super::project::consumption::take;
    use crate::package_route::stamp::InputStamp;
    let resolved = take(facts, normalize_path_consumed(tsconfig_path, observe));
    if !seen.insert(resolved.clone()) {
        return;
    }
    paths.push(resolved.clone());
    let content = match std::fs::read_to_string(&resolved) {
        Ok(content) => {
            if observe {
                facts.stamps.push(InputStamp::observed_source(
                    resolved.clone(),
                    content.as_bytes(),
                ));
            }
            content
        }
        Err(error) => {
            if observe {
                facts.stamps.push(InputStamp::observed_read_failure(
                    resolved.clone(),
                    error.kind(),
                ));
            }
            facts.qualified = false;
            return;
        }
    };
    let Ok(value) = parse_jsonc_value(&content) else {
        facts.qualified = false;
        return;
    };
    let reference_value = value.get("references");
    let references = reference_value.and_then(Value::as_array);
    if reference_value.is_some() && references.is_none_or(|entries| !entries.is_empty()) {
        facts.qualified = false;
    }
    for reference in references
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("path").and_then(Value::as_str))
    {
        let Some(referenced) = take(
            facts,
            resolve_reference_consumed(&resolved, reference, observe),
        ) else {
            continue;
        };
        collect_inner_consumed(&referenced, seen, paths, observe, facts);
    }
}

fn resolve_reference_consumed(
    tsconfig_path: &Path,
    reference: &str,
    observe: bool,
) -> crate::package_route::stamp::Consumed<Option<PathBuf>> {
    use super::super::super::project::consumption::{empty, finish, take};
    let mut facts = empty(observe && tsconfig_path.is_absolute());
    let base_dir = tsconfig_path.parent().unwrap_or(Path::new("."));
    let reference = Path::new(reference);
    let base = if reference.is_absolute() {
        reference.to_path_buf()
    } else {
        base_dir.join(reference)
    };
    let candidate = config_candidates(base)
        .into_iter()
        .map(|candidate| normalize_path_lexically(&candidate))
        .find(|candidate| {
            let is_file = candidate.is_file();
            if observe {
                facts
                    .stamps
                    .push(crate::package_route::stamp::InputStamp::observed_is_file(
                        candidate.clone(),
                        is_file,
                    ));
            }
            is_file
        });
    let value =
        candidate.map(|candidate| take(&mut facts, normalize_path_consumed(&candidate, observe)));
    facts.qualified &= value.is_some();
    finish(facts, value)
}

fn config_candidates(base: PathBuf) -> Vec<PathBuf> {
    if base.extension().is_some() {
        return vec![base];
    }
    vec![
        base.clone(),
        base.with_extension("json"),
        base.join("tsconfig.json"),
    ]
}

pub(super) fn normalize_path(path: &Path) -> PathBuf {
    vize_carton::path::canonicalize_non_verbatim(&normalize_path_lexically(path))
}

pub(super) fn normalize_path_consumed(
    path: &Path,
    observe: bool,
) -> crate::package_route::stamp::Consumed<PathBuf> {
    super::super::super::VirtualProject::canonical_configuration_path(
        &normalize_path_lexically(path),
        observe,
    )
}
