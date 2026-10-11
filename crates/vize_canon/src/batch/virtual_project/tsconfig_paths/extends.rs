//! Original extends resolution, with optional same-operation consumed facts.
use super::{normalize_path_lexically, parse_jsonc_value};
use crate::package_route::stamp::{Consumed, InputStamp};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(crate) fn resolve_extended_tsconfig_path(
    tsconfig_path: &Path,
    extends: &str,
) -> Option<PathBuf> {
    resolve_extended_tsconfig_path_inner(tsconfig_path, extends, None)
}

pub(crate) fn resolve_extended_tsconfig_path_observed(
    tsconfig_path: &Path,
    extends: &str,
) -> Consumed<Option<PathBuf>> {
    let mut stamps = Vec::new();
    let value = resolve_extended_tsconfig_path_inner(tsconfig_path, extends, Some(&mut stamps));
    Consumed {
        value,
        stamps,
        qualified: tsconfig_path.is_absolute(),
    }
}

fn resolve_extended_tsconfig_path_inner(
    tsconfig_path: &Path,
    extends: &str,
    mut stamps: Option<&mut Vec<InputStamp>>,
) -> Option<PathBuf> {
    let base_dir = tsconfig_path.parent().unwrap_or(Path::new("."));
    let extends_path = Path::new(extends);
    if !(extends_path.is_absolute()
        || extends.starts_with("./")
        || extends.starts_with("../")
        || extends == "."
        || extends == "..")
    {
        // Bare specifier (`@vue/tsconfig/tsconfig.dom.json`): resolved like a
        // Node import, walking ancestor `node_modules` directories from the
        // extending config.
        return resolve_package_tsconfig_path(base_dir, extends, stamps);
    }

    let base = if extends_path.is_absolute() {
        extends_path.to_path_buf()
    } else {
        base_dir.join(extends_path)
    };

    tsconfig_path_candidates(base)
        .into_iter()
        .map(|candidate| normalize_path_lexically(&candidate))
        .find(|candidate| original_exists(candidate, stamps.as_deref_mut()))
}

fn resolve_package_tsconfig_path(
    base_dir: &Path,
    extends: &str,
    mut stamps: Option<&mut Vec<InputStamp>>,
) -> Option<PathBuf> {
    let (package, subpath) = split_package_specifier(extends)?;
    let mut current = Some(base_dir);
    while let Some(dir) = current {
        let package_root = dir.join("node_modules").join(package);
        let from_package_json = if subpath.is_none() {
            original_utf8_read(&package_root.join("package.json"), stamps.as_deref_mut())
                .and_then(|content| parse_jsonc_value(&content).ok())
                .and_then(|package| {
                    package
                        .get("tsconfig")
                        .and_then(Value::as_str)
                        .map(|target| package_root.join(target))
                })
        } else {
            None
        };
        let base = subpath.map_or_else(
            || package_root.join("tsconfig.json"),
            |subpath| package_root.join(subpath),
        );
        if let Some(found) = from_package_json
            .into_iter()
            .flat_map(tsconfig_path_candidates)
            .chain(tsconfig_path_candidates(base))
            .map(|candidate| normalize_path_lexically(&candidate))
            .find(|candidate| original_is_file(candidate, stamps.as_deref_mut()))
        {
            // Resolve through the link before returning. A bare specifier goes
            // through Node resolution, which follows symlinks unless
            // `preserveSymlinks` is set, so the config's own directory — the
            // anchor for every relative option it declares — is the real one,
            // not the `node_modules` entry that pointed at it. Under pnpm those
            // differ for every workspace package: rebasing a relative
            // `typeRoots` against `<pkg>/node_modules/<dep>/...` walked back out
            // through `node_modules` and produced `node_modules/node_modules/
            // @types`, a directory that cannot exist, and the resulting TS2688
            // is a global failure that suppresses every per-file diagnostic
            // (#4425).
            let selected = vize_carton::path::canonicalize_non_verbatim(&found);
            if let Some(stamps) = stamps.as_deref_mut() {
                stamps.push(InputStamp::observed_canonical_path(found, selected.clone()));
            }
            return Some(selected);
        }
        current = dir.parent();
    }
    None
}

fn split_package_specifier(extends: &str) -> Option<(&str, Option<&str>)> {
    let first = extends.split('/').next()?;
    if first.is_empty() {
        return None;
    }
    if first.starts_with('@') {
        let name = extends.get(first.len() + 1..)?.split('/').next()?;
        if name.is_empty() {
            return None;
        }
        let package_len = first.len() + 1 + name.len();
        return Some((
            extends.get(..package_len)?,
            extends
                .get(package_len + 1..)
                .filter(|path| !path.is_empty()),
        ));
    }
    Some((
        first,
        extends
            .get(first.len() + 1..)
            .filter(|path| !path.is_empty()),
    ))
}

fn tsconfig_path_candidates(base: PathBuf) -> Vec<PathBuf> {
    if base.extension().is_some() {
        return vec![base];
    }

    vec![
        base.clone(),
        base.with_extension("json"),
        base.join("tsconfig.json"),
    ]
}

fn original_exists(path: &Path, stamps: Option<&mut Vec<InputStamp>>) -> bool {
    let result = path.exists();
    if let Some(stamps) = stamps {
        stamps.push(InputStamp::observed_exists(path.to_path_buf(), result));
    }
    result
}

fn original_is_file(path: &Path, stamps: Option<&mut Vec<InputStamp>>) -> bool {
    let result = path.is_file();
    if let Some(stamps) = stamps {
        stamps.push(InputStamp::observed_is_file(path.to_path_buf(), result));
    }
    result
}

#[expect(clippy::disallowed_types, reason = "original UTF-8 read result")]
fn original_utf8_read(path: &Path, stamps: Option<&mut Vec<InputStamp>>) -> Option<String> {
    match std::fs::read_to_string(path) {
        Ok(body) => {
            if let Some(stamps) = stamps {
                stamps.push(InputStamp::observed_source(
                    path.to_path_buf(),
                    body.as_bytes(),
                ));
            }
            Some(body)
        }
        Err(error) => {
            if let Some(stamps) = stamps {
                stamps.push(InputStamp::observed_read_failure(
                    path.to_path_buf(),
                    error.kind(),
                ));
            }
            None
        }
    }
}

#[cfg(test)]
mod tests;
