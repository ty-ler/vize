//! Relative and tsconfig-path resolution used by dependency reachability.

use std::path::{Component, Path, PathBuf};

use crate::package_route::stamp::{Consumed, InputStamp};
use vize_carton::{String as CompactString, cstr};

/// First-party classification key: workspace symlinks use physical identity.
pub(super) fn canonical_key(path: &Path) -> Option<PathBuf> {
    canonical_key_inner(path, None)
}

pub(super) fn canonical_key_observed(path: &Path) -> Consumed<Option<PathBuf>> {
    let mut stamps = Vec::new();
    let value = canonical_key_inner(path, Some(&mut stamps));
    Consumed {
        value,
        stamps,
        qualified: true,
    }
}

fn canonical_key_inner(path: &Path, stamps: Option<&mut Vec<InputStamp>>) -> Option<PathBuf> {
    let canonical = vize_carton::path::canonicalize_non_verbatim(path);
    let is_file = canonical.is_file();
    if let Some(stamps) = stamps {
        stamps.push(InputStamp::observed_canonical_file(
            path.to_path_buf(),
            canonical.clone(),
            is_file,
        ));
    }
    is_file.then_some(canonical)
}

pub(super) fn inside_node_modules(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::Normal(part) if part == "node_modules"))
}

pub(super) fn is_declaration_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
        })
}

pub(super) fn alias_may_reach_first_party(
    pattern: &str,
    target: &str,
    project_root: &Path,
) -> bool {
    alias_may_reach_first_party_inner(pattern, target, project_root, None)
}

pub(super) fn alias_may_reach_first_party_observed(
    pattern: &str,
    target: &str,
    project_root: &Path,
) -> Consumed<bool> {
    let mut stamps = Vec::new();
    let value = alias_may_reach_first_party_inner(pattern, target, project_root, Some(&mut stamps));
    Consumed {
        value,
        stamps,
        qualified: true,
    }
}

fn alias_may_reach_first_party_inner(
    pattern: &str,
    target: &str,
    project_root: &Path,
    mut stamps: Option<&mut Vec<InputStamp>>,
) -> bool {
    if pattern.contains('*') {
        return true;
    }
    let absolute = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        project_root.join(target)
    };
    let Some(resolved) = probe_candidates_with_inputs_inner(&absolute, stamps.as_deref_mut()).0
    else {
        return false;
    };
    let Some(key) = canonical_key_inner(&resolved, stamps) else {
        return false;
    };
    !inside_node_modules(&key) && !is_declaration_file(&key)
}

pub(super) fn may_resolve_a_dependency(
    content: &str,
    alias_prefixes: &[CompactString],
    workspace_package_specifiers: &[CompactString],
) -> bool {
    crate::batch::import_rewriter::source_may_contain_relative_specifier(content)
        || alias_prefixes
            .iter()
            .any(|prefix| prefix.is_empty() || content.contains(prefix.as_str()))
        || workspace_package_specifiers
            .iter()
            .any(|specifier| content.contains(specifier.as_str()))
}

/// Resolve one specifier to a registrable first-party file, or `None`.
#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
pub(crate) fn resolve_dependency(
    specifier: &str,
    importer_dir: &Path,
    project_root: &Path,
    aliases: &[(std::string::String, std::string::String)],
) -> Option<PathBuf> {
    resolve_dependency_with_inputs(specifier, importer_dir, project_root, aliases).0
}

#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
pub(crate) fn resolve_dependency_with_inputs(
    specifier: &str,
    importer_dir: &Path,
    project_root: &Path,
    aliases: &[(std::string::String, std::string::String)],
) -> (Option<PathBuf>, Vec<PathBuf>) {
    resolve_dependency_with_inputs_inner(specifier, importer_dir, project_root, aliases, None)
}

#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
pub(crate) fn resolve_dependency_observed(
    specifier: &str,
    importer_dir: &Path,
    project_root: &Path,
    aliases: &[(std::string::String, std::string::String)],
) -> Consumed<(Option<PathBuf>, Vec<PathBuf>)> {
    let mut stamps = Vec::new();
    let value = resolve_dependency_with_inputs_inner(
        specifier,
        importer_dir,
        project_root,
        aliases,
        Some(&mut stamps),
    );
    Consumed {
        value,
        stamps,
        qualified: true,
    }
}

#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
fn resolve_dependency_with_inputs_inner(
    specifier: &str,
    importer_dir: &Path,
    project_root: &Path,
    aliases: &[(std::string::String, std::string::String)],
    mut stamps: Option<&mut Vec<InputStamp>>,
) -> (Option<PathBuf>, Vec<PathBuf>) {
    let specifier = specifier
        .strip_suffix(".vue.ts")
        .map_or_else(|| specifier.to_owned(), |stem| cstr!("{stem}.vue").into());
    if specifier.starts_with("./")
        || specifier.starts_with("../")
        || Path::new(&specifier).is_absolute()
    {
        return probe_candidates_with_inputs_inner(&importer_dir.join(&specifier), stamps);
    }

    // Select the authored pattern before probing its targets. An exact key
    // wins even when it has no files; otherwise only the longest matching
    // wildcard prefix wins. Equal prefixes retain their incoming order.
    let mut selected: Option<(&str, Option<&str>, usize)> = None;
    for (pattern, _) in aliases {
        if !pattern.contains('*') && specifier == *pattern {
            selected = Some((pattern, None, 0));
            break;
        }
        let Some((prefix, suffix)) = pattern.split_once('*') else {
            continue;
        };
        if suffix.contains('*') {
            continue;
        }
        let Some(capture) = specifier
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix(suffix))
        else {
            continue;
        };
        if selected.is_none_or(|(_, _, length)| prefix.len() > length) {
            selected = Some((pattern, Some(capture), prefix.len()));
        }
    }
    let Some((selected_pattern, capture, _)) = selected else {
        return (None, Vec::new());
    };
    let mut inputs = Vec::new();
    for (pattern, target) in aliases {
        if pattern != selected_pattern {
            continue;
        }
        let substituted = if let Some(capture) = capture {
            target.split_once('*').and_then(|(prefix, suffix)| {
                if suffix.contains('*') {
                    return None;
                }
                let mut joined = prefix.to_owned();
                joined.push_str(capture);
                joined.push_str(suffix);
                Some(joined)
            })
        } else {
            Some(target.clone())
        };
        let Some(substituted) = substituted else {
            continue;
        };
        let absolute = if Path::new(&substituted).is_absolute() {
            PathBuf::from(&substituted)
        } else {
            project_root.join(&substituted)
        };
        let (resolved, consulted) =
            probe_candidates_with_inputs_inner(&absolute, stamps.as_deref_mut());
        inputs.extend(consulted);
        if resolved.is_some() {
            return (resolved, inputs);
        }
    }
    (None, inputs)
}

pub(super) fn probe_candidates(base: &Path) -> Option<PathBuf> {
    probe_candidates_with_inputs(base).0
}

pub(super) fn probe_candidates_observed(base: &Path) -> Consumed<Option<PathBuf>> {
    let mut stamps = Vec::new();
    let value = probe_candidates_with_inputs_inner(base, Some(&mut stamps)).0;
    Consumed {
        value,
        stamps,
        qualified: true,
    }
}

fn probe_candidates_with_inputs(base: &Path) -> (Option<PathBuf>, Vec<PathBuf>) {
    probe_candidates_with_inputs_inner(base, None)
}

fn probe_candidates_with_inputs_inner(
    base: &Path,
    mut stamps: Option<&mut Vec<InputStamp>>,
) -> (Option<PathBuf>, Vec<PathBuf>) {
    let mut inputs = vec![base.to_path_buf()];
    let extension = base.extension().and_then(|extension| extension.to_str());
    // TypeScript substitutes type-bearing extensions before consulting the
    // JavaScript runtime file, even when that runtime file exists.
    let extensions: &[&str] = match extension {
        Some("js" | "jsx") => &["ts", "tsx", "d.ts", "js", "jsx"],
        Some("mjs") => &["mts", "d.mts", "mjs"],
        Some("cjs") => &["cts", "d.cts", "cjs"],
        _ if file_predicate(base, &mut stamps) => return (Some(base.to_path_buf()), inputs),
        Some("vue" | "ts" | "tsx" | "mts" | "cts" | "json") => return (None, inputs),
        _ => &[
            "ts", "tsx", "d.ts", "mts", "d.mts", "cts", "d.cts", "vue", "js", "jsx", "mjs", "cjs",
        ],
    };
    let runtime_extension = matches!(extension, Some("js" | "jsx" | "mjs" | "cjs"));
    let probe_base = if runtime_extension {
        base.with_extension("")
    } else {
        base.to_path_buf()
    };
    for extension in extensions {
        let candidate = PathBuf::from(cstr!("{}.{extension}", probe_base.display()).as_str());
        inputs.push(candidate.clone());
        if file_predicate(&candidate, &mut stamps) {
            return (Some(candidate), inputs);
        }
    }
    if runtime_extension {
        return (None, inputs);
    }
    for index in [
        "index.ts",
        "index.tsx",
        "index.d.ts",
        "index.mts",
        "index.d.mts",
        "index.cts",
        "index.d.cts",
        "index.vue",
        "index.js",
        "index.jsx",
        "index.mjs",
        "index.cjs",
    ] {
        let candidate = base.join(index);
        inputs.push(candidate.clone());
        if file_predicate(&candidate, &mut stamps) {
            return (Some(candidate), inputs);
        }
    }
    (None, inputs)
}

fn file_predicate(path: &Path, stamps: &mut Option<&mut Vec<InputStamp>>) -> bool {
    let is_file = path.is_file();
    if let Some(stamps) = stamps {
        stamps.push(InputStamp::observed_is_file(path.to_path_buf(), is_file));
    }
    is_file
}

#[cfg(test)]
#[path = "alias_tests.rs"]
mod alias_tests;

#[cfg(test)]
#[path = "precedence_tests.rs"]
mod precedence_tests;
