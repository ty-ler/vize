//! Pure package source spellings; the probing order remains in source.rs.

use super::PackageSourceOptions;
use std::path::{Component, Path, PathBuf};
use vize_carton::cstr;

const TS_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".vue", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts",
];
const JSX_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".vue", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts", ".jsx",
];
const JS_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".vue", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts", ".js", ".jsx", ".mjs",
    ".cjs",
];

pub(super) fn native_probe_for_source(target: &Path, source: &Path) -> PathBuf {
    if source
        .extension()
        .is_none_or(|extension| extension != "vue")
    {
        return source.to_path_buf();
    }
    match target.extension().and_then(|extension| extension.to_str()) {
        Some("vue") => target.with_extension("d.vue.ts"),
        Some("mjs") => target.with_extension("mts"),
        Some("cjs") => target.with_extension("cts"),
        Some("js" | "jsx") => target.with_extension("ts"),
        _ => source.with_extension("ts"),
    }
}

pub(super) fn source_extensions(options: PackageSourceOptions) -> &'static [&'static str] {
    if options.include_javascript {
        JS_EXTENSIONS
    } else if options.include_jsx {
        JSX_EXTENSIONS
    } else {
        TS_EXTENSIONS
    }
}

pub(super) fn accepted_source(path: &Path, options: PackageSourceOptions) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    TS_EXTENSIONS
        .iter()
        .any(|extension| name.ends_with(extension))
        || options.include_javascript
            && [".js", ".jsx", ".mjs", ".cjs"]
                .iter()
                .any(|extension| name.ends_with(extension))
        || options.include_jsx && name.ends_with(".jsx")
}

pub(super) fn declaration_sidecars(path: &Path) -> Vec<PathBuf> {
    let extensions: &[&str] = match path.extension().and_then(|ext| ext.to_str()) {
        Some("mjs") => &["d.mts", "d.ts"],
        Some("cjs") => &["d.cts", "d.ts"],
        Some("js" | "jsx") => &["d.ts"],
        _ => &[],
    };
    extensions
        .iter()
        .map(|extension| path.with_extension(extension))
        .collect()
}

/// The authored TypeScript-family file a runtime target was emitted from.
pub(super) fn typescript_twins(path: &Path) -> Vec<PathBuf> {
    let extensions: &[&str] = match path.extension().and_then(|ext| ext.to_str()) {
        Some("js") => &["ts", "tsx", "vue"],
        Some("jsx") => &["tsx", "ts", "vue"],
        Some("mjs") => &["mts", "vue"],
        Some("cjs") => &["cts", "vue"],
        _ => &[],
    };
    extensions
        .iter()
        .map(|extension| path.with_extension(extension))
        .collect()
}

pub(super) fn workspace_source_fallback_base(
    target: &Path,
    package_root: &Path,
) -> Option<PathBuf> {
    let relative = target.strip_prefix(package_root).ok()?;
    let mut components = relative.components();
    let first = components.next()?;
    let Component::Normal(output_dir) = first else {
        return None;
    };
    let output_dir = output_dir.to_str()?;
    if !matches!(output_dir, "built" | "dist" | "lib") {
        return None;
    }
    let mut fallback = package_root.join("src");
    let mut saw_leaf = false;
    for component in components {
        let Component::Normal(part) = component else {
            return None;
        };
        fallback.push(part);
        saw_leaf = true;
    }
    if saw_leaf {
        strip_emitted_suffix(fallback)
    } else {
        None
    }
}

fn strip_emitted_suffix(path: PathBuf) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    for suffix in [".d.mts", ".d.cts", ".d.ts", ".mjs", ".cjs", ".jsx", ".js"] {
        let Some(stem) = name.strip_suffix(suffix) else {
            continue;
        };
        if stem.is_empty() {
            return None;
        }
        return Some(path.with_file_name(stem));
    }
    Some(path)
}

pub(super) fn workspace_source_fallback_probe(target: &Path, source: &Path) -> PathBuf {
    let target_base = strip_emitted_suffix(target.to_path_buf()).unwrap_or_else(|| target.into());
    let Some(suffix) = source_probe_suffix(source) else {
        return source.into();
    };
    if suffix == ".vue" {
        return target_base.with_extension("ts");
    }
    target_base.with_extension(suffix.trim_start_matches('.'))
}

fn source_probe_suffix(path: &Path) -> Option<&'static str> {
    let name = path.file_name().and_then(|name| name.to_str())?;
    [
        ".d.mts", ".d.cts", ".d.ts", ".tsx", ".mts", ".cts", ".ts", ".vue", ".jsx", ".mjs", ".cjs",
        ".js",
    ]
    .into_iter()
    .find(|suffix| name.ends_with(suffix))
}

pub(super) fn append_extension(base: &Path, extension: &str) -> PathBuf {
    base.file_name().and_then(|name| name.to_str()).map_or_else(
        || base.to_path_buf(),
        |name| base.with_file_name(cstr!("{name}{extension}").as_str()),
    )
}
