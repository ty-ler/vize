use std::path::{Path, PathBuf};

use serde_json::Value;
use vize_carton::FxHashMap;

use super::stamp::{Consumed, InputStamp, InputStampCache, manifest_path};

const MANIFEST_CACHE_CAPACITY: usize = 1_024;

#[derive(Default)]
pub(super) struct PackageSearchCache {
    manifests: FxHashMap<PathBuf, CachedManifest>,
    stamp_snapshots: InputStampCache,
    manifest_reads: u64,
    validation_epoch: u64,
    clock: u64,
    evictions: u64,
}

struct CachedManifest {
    stamp: InputStamp,
    value: Option<Value>,
    last_used: u64,
    last_validated_epoch: u64,
}

impl PackageSearchCache {
    pub(super) fn clear(&mut self) {
        self.manifests.clear();
        self.stamp_snapshots.clear();
        self.manifest_reads = 0;
        self.validation_epoch = 0;
        self.clock = 0;
        self.evictions = 0;
    }

    pub(super) fn begin_validation_epoch(&mut self) {
        self.validation_epoch = self.validation_epoch.wrapping_add(1).max(1);
        self.stamp_snapshots.clear();
    }

    pub(super) fn manifest_reads(&self) -> u64 {
        self.manifest_reads
    }

    pub(super) fn len(&self) -> usize {
        self.manifests.len()
    }

    pub(super) fn evictions(&self) -> u64 {
        self.evictions
    }

    #[cfg(test)]
    fn read_manifest(&mut self, root: &Path) -> Option<Value> {
        self.read_manifest_observed(root).value
    }

    fn read_manifest_observed(&mut self, root: &Path) -> Consumed<Option<Value>> {
        let path = manifest_path(root);
        let validation_epoch = self.validation_epoch;
        if let Some(cached) = self.manifests.get_mut(&path) {
            let current = validation_epoch != 0 && cached.last_validated_epoch == validation_epoch
                || if validation_epoch == 0 {
                    cached.stamp.route_cache_is_current()
                } else {
                    cached
                        .stamp
                        .route_cache_is_current_with_cache(&mut self.stamp_snapshots)
                };
            if current {
                if validation_epoch != 0 {
                    cached.last_validated_epoch = validation_epoch;
                }
                self.clock = self.clock.wrapping_add(1);
                cached.last_used = self.clock;
                let stamp = cached.stamp.retained_consumed_source();
                return Consumed {
                    value: cached.value.clone(),
                    qualified: path.is_absolute()
                        && stamp
                            .as_ref()
                            .is_some_and(|stamp| !stamp.has_non_not_found_read_failure()),
                    stamps: stamp.into_iter().collect(),
                };
            }
        }
        self.manifests.remove(&path);
        let mut stamp = if self.validation_epoch == 0 {
            InputStamp::capture(&path)
        } else {
            self.stamp_snapshots.capture(&path)
        };
        self.manifest_reads += 1;
        let value = match std::fs::read_to_string(&path) {
            Ok(content) => {
                stamp = stamp.with_consumed_source(content.as_bytes());
                serde_json::from_str(&content).ok()
            }
            Err(error) => {
                stamp = stamp.with_consumed_read_failure(error.kind());
                None
            }
        };
        let consumed = stamp.retained_consumed_source();
        let qualified = path.is_absolute()
            && consumed
                .as_ref()
                .is_some_and(|stamp| !stamp.has_non_not_found_read_failure());
        if self.manifests.len() >= MANIFEST_CACHE_CAPACITY {
            let oldest = self
                .manifests
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(path, _)| path.clone());
            if let Some(oldest) = oldest {
                self.manifests.remove(&oldest);
                self.evictions += 1;
            }
        }
        self.clock = self.clock.wrapping_add(1);
        self.manifests.insert(
            path,
            CachedManifest {
                stamp,
                value: value.clone(),
                last_used: self.clock,
                last_validated_epoch: self.validation_epoch,
            },
        );
        Consumed {
            value,
            stamps: consumed.into_iter().collect(),
            qualified,
        }
    }
}

pub(super) struct PackageRequest<'a> {
    pub(super) package: &'a str,
    pub(super) subpath: Option<&'a str>,
}

impl<'a> PackageRequest<'a> {
    pub(super) fn parse(specifier: &'a str) -> Option<Self> {
        if specifier.is_empty()
            || specifier.starts_with(['.', '/', '#'])
            || is_absolute_specifier(specifier)
        {
            return None;
        }
        let package_end = if let Some(scoped) = specifier.strip_prefix('@') {
            let scope_end = scoped.find('/')?;
            if scope_end == 0 {
                return None;
            }
            let scope_end = scope_end + 1;
            let package_end = specifier
                .get(scope_end + 1..)?
                .find('/')
                .map_or(specifier.len(), |end| scope_end + 1 + end);
            if package_end == scope_end + 1 {
                return None;
            }
            package_end
        } else {
            specifier.find('/').unwrap_or(specifier.len())
        };
        Some(Self {
            package: specifier.get(..package_end)?,
            subpath: specifier
                .get(package_end + 1..)
                .filter(|subpath| !subpath.is_empty()),
        })
    }
}

fn is_absolute_specifier(specifier: &str) -> bool {
    if Path::new(specifier).is_absolute() || specifier.starts_with("\\\\") {
        return true;
    }
    matches!(
        specifier.as_bytes(),
        [drive, b':', b'/' | b'\\', ..] if drive.is_ascii_alphabetic()
    )
}

pub(super) fn find_package_root_observed(
    importer_dir: &Path,
    package: &str,
    invalidation_paths: &mut Vec<PathBuf>,
    cache: &mut PackageSearchCache,
) -> Consumed<Option<PathBuf>> {
    let mut stamps = Vec::new();
    let mut qualified = importer_dir.is_absolute();
    // Preserve the separate nearest-scope self-reference pass and early break.
    for dir in importer_dir.ancestors() {
        invalidation_paths.push(dir.join("package.json"));
        let consumed = read_manifest_observed(dir, cache);
        stamps.extend(consumed.stamps);
        qualified &= consumed.qualified;
        if let Some(manifest) = consumed.value {
            if manifest.get("name").and_then(Value::as_str) == Some(package) {
                return Consumed {
                    value: Some(dir.to_path_buf()),
                    stamps,
                    qualified,
                };
            }
            break;
        }
    }
    for dir in importer_dir.ancestors() {
        let candidate = dir.join("node_modules").join(package);
        let manifest = candidate.join("package.json");
        invalidation_paths.push(candidate.clone());
        invalidation_paths.push(manifest.clone());
        let is_file = manifest.is_file();
        stamps.push(InputStamp::observed_is_file(manifest, is_file));
        if is_file {
            return Consumed {
                value: Some(candidate),
                stamps,
                qualified,
            };
        }
    }
    Consumed {
        value: None,
        stamps,
        qualified,
    }
}

pub(super) fn nearest_package_manifest_observed(
    start: &Path,
    invalidation_paths: &mut Vec<PathBuf>,
    cache: &mut PackageSearchCache,
) -> Consumed<Option<(PathBuf, Value)>> {
    let mut stamps = Vec::new();
    let mut qualified = start.is_absolute();
    for dir in start.ancestors() {
        invalidation_paths.push(dir.join("package.json"));
        let consumed = read_manifest_observed(dir, cache);
        stamps.extend(consumed.stamps);
        qualified &= consumed.qualified;
        if let Some(manifest) = consumed.value {
            return Consumed {
                value: Some((dir.to_path_buf(), manifest)),
                stamps,
                qualified,
            };
        }
    }
    Consumed {
        value: None,
        stamps,
        qualified,
    }
}

pub(super) fn read_manifest_observed(
    root: &Path,
    cache: &mut PackageSearchCache,
) -> Consumed<Option<Value>> {
    cache.read_manifest_observed(root)
}

#[expect(clippy::disallowed_methods, reason = "fixtures use std strings")]
#[cfg(test)]
mod tests {
    use super::{MANIFEST_CACHE_CAPACITY, PackageSearchCache};

    #[test]
    fn manifest_cache_has_a_measured_hard_bound() {
        let root = tempfile::tempdir().unwrap();
        let mut cache = PackageSearchCache::default();
        for index in 0..=MANIFEST_CACHE_CAPACITY {
            let package = root.path().join(index.to_string());
            std::fs::create_dir_all(&package).unwrap();
            std::fs::write(package.join("package.json"), r#"{"name":"bounded"}"#).unwrap();
            assert!(cache.read_manifest(&package).is_some());
        }

        assert_eq!(cache.len(), MANIFEST_CACHE_CAPACITY);
        assert_eq!(cache.evictions(), 1);
    }
}

#[cfg(test)]
mod read_failure_tests;
