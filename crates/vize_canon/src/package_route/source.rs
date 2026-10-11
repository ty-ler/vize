//! TypeScript-family source probing for package route targets.

use std::path::{Path, PathBuf};

use vize_carton::cstr;

use super::stamp::InputStamp;
use super::{PackagePathCache, PackageSourceOptions, canonical_path};
#[path = "source_paths.rs"]
mod paths;
use paths::{
    accepted_source, append_extension, declaration_sidecars, native_probe_for_source,
    source_extensions, typescript_twins, workspace_source_fallback_base,
    workspace_source_fallback_probe,
};

pub(super) struct ResolvedPackageSource {
    pub(super) source_path: PathBuf,
    pub(super) native_probe_path: PathBuf,
}

pub(super) fn resolve_sources(
    base: &Path,
    options: PackageSourceOptions,
    consulted: &mut Vec<PathBuf>,
    canonical_paths: &mut PackagePathCache,
    stamps: &mut Vec<InputStamp>,
) -> Vec<ResolvedPackageSource> {
    let mut resolved = Vec::new();
    // A declaration sidecar stands in for its runtime module even when that
    // module is absent, so probe it before requiring `base` on disk.
    for sidecar in declaration_sidecars(base) {
        record_if_file(
            &sidecar,
            &sidecar,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    consulted.push(canonical_path(base, canonical_paths, stamps));
    let is_file = base.is_file();
    stamps.push(InputStamp::observed_is_file(base.to_path_buf(), is_file));
    if is_file && accepted_source(base, options) {
        resolved.push(ResolvedPackageSource {
            source_path: canonical_path(base, canonical_paths, stamps),
            native_probe_path: canonical_path(
                &native_probe_for_source(base, base),
                canonical_paths,
                stamps,
            ),
        });
    }
    // A manifest may name the built runtime target (`./dist/index.js`) that a
    // source checkout never emits; its authored twin carries a TypeScript
    // extension in the same place, so swap the extension before appending one.
    for twin in typescript_twins(base) {
        let probe = native_probe_for_source(base, &twin);
        record_if_file(
            &twin,
            &probe,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    for extension in source_extensions(options) {
        let candidate = append_extension(base, extension);
        let probe = native_probe_for_source(base, &candidate);
        record_if_file(
            &candidate,
            &probe,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    for extension in source_extensions(options) {
        let candidate = base.join(cstr!("index{extension}").as_str());
        let probe = native_probe_for_source(base, &candidate);
        record_if_file(
            &candidate,
            &probe,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    resolved.sort_by(|left, right| {
        (&left.source_path, &left.native_probe_path)
            .cmp(&(&right.source_path, &right.native_probe_path))
    });
    resolved.dedup_by(|left, right| {
        left.source_path == right.source_path && left.native_probe_path == right.native_probe_path
    });
    resolved
}

pub(super) fn resolve_workspace_source_fallbacks(
    target: &Path,
    package_root: &Path,
    options: PackageSourceOptions,
    consulted: &mut Vec<PathBuf>,
    canonical_paths: &mut PackagePathCache,
    stamps: &mut Vec<InputStamp>,
) -> Vec<ResolvedPackageSource> {
    let Some(base) = workspace_source_fallback_base(target, package_root) else {
        return Vec::new();
    };
    let mut resolved = Vec::new();
    consulted.push(canonical_path(&base, canonical_paths, stamps));
    if accepted_source(&base, options) {
        record_workspace_fallback_if_file(
            target,
            &base,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    for extension in source_extensions(options) {
        let candidate = append_extension(&base, extension);
        record_workspace_fallback_if_file(
            target,
            &candidate,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    for extension in source_extensions(options) {
        let candidate = base.join(cstr!("index{extension}").as_str());
        record_workspace_fallback_if_file(
            target,
            &candidate,
            consulted,
            &mut resolved,
            canonical_paths,
            stamps,
        );
    }
    resolved.sort_by(|left, right| {
        (&left.source_path, &left.native_probe_path)
            .cmp(&(&right.source_path, &right.native_probe_path))
    });
    resolved.dedup_by(|left, right| {
        left.source_path == right.source_path && left.native_probe_path == right.native_probe_path
    });
    resolved
}

fn record_if_file(
    path: &Path,
    native_probe: &Path,
    consulted: &mut Vec<PathBuf>,
    resolved: &mut Vec<ResolvedPackageSource>,
    canonical_paths: &mut PackagePathCache,
    stamps: &mut Vec<InputStamp>,
) {
    let path = canonical_path(path, canonical_paths, stamps);
    consulted.push(path.clone());
    let is_file = path.is_file();
    stamps.push(InputStamp::observed_is_file(path.clone(), is_file));
    if is_file {
        resolved.push(ResolvedPackageSource {
            source_path: path,
            native_probe_path: canonical_path(native_probe, canonical_paths, stamps),
        });
    }
}

fn record_workspace_fallback_if_file(
    target: &Path,
    path: &Path,
    consulted: &mut Vec<PathBuf>,
    resolved: &mut Vec<ResolvedPackageSource>,
    canonical_paths: &mut PackagePathCache,
    stamps: &mut Vec<InputStamp>,
) {
    let path = canonical_path(path, canonical_paths, stamps);
    consulted.push(path.clone());
    let is_file = path.is_file();
    stamps.push(InputStamp::observed_is_file(path.clone(), is_file));
    if is_file {
        let native_probe = workspace_source_fallback_probe(target, &path);
        resolved.push(ResolvedPackageSource {
            source_path: path,
            native_probe_path: canonical_path(&native_probe, canonical_paths, stamps),
        });
    }
}
