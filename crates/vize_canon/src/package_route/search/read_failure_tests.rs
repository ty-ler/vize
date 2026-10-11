//! Same original manifest reads retain their exact positive or negative facts.
use super::{CachedManifest, PackageSearchCache, nearest_package_manifest_observed};
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use std::{io::ErrorKind, sync::Arc};

#[test]
fn absent_ancestors_retain_actual_failures_before_the_root_manifest() {
    let root = tempfile::tempdir().unwrap();
    let nested = root.path().join("src/nested");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(root.path().join("package.json"), r#"{"name":"root"}"#).unwrap();
    let mut cache = PackageSearchCache::default();
    let mut paths = Vec::new();
    let consumed = nearest_package_manifest_observed(&nested, &mut paths, &mut cache);
    assert_eq!(
        consumed.value,
        Some((
            root.path().to_path_buf(),
            serde_json::json!({"name":"root"})
        ))
    );
    assert!(consumed.qualified);
    assert_eq!(cache.manifest_reads(), 3);
    assert_eq!(consumed.stamps.len(), 3);
    for (stamp, path) in consumed.stamps[..2].iter().zip(&paths[..2]) {
        let kind = std::fs::read_to_string(path).unwrap_err().kind();
        assert_eq!(kind, ErrorKind::NotFound);
        assert_eq!(
            *stamp,
            InputStamp::observed_read_failure(path.clone(), kind)
        );
    }
    assert_eq!(
        paths,
        vec![
            nested.join("package.json"),
            root.path().join("src/package.json"),
            root.path().join("package.json")
        ]
    );
}

#[test]
fn cached_negative_keeps_original_provenance_and_refuses_a_later_positive() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("package.json");
    let mut cache = PackageSearchCache::default();
    cache.begin_validation_epoch();
    let first = cache.read_manifest_observed(root.path());
    let cached = cache.read_manifest_observed(root.path());
    assert!(first.value.is_none() && first.qualified && cached.qualified);
    assert_eq!(first.stamps, cached.stamps);
    assert_eq!(
        first.stamps,
        vec![InputStamp::observed_read_failure(
            path.clone(),
            ErrorKind::NotFound
        )]
    );
    assert_eq!(cache.manifest_reads(), 1);
    std::fs::write(&path, r#"{"name":"new"}"#).unwrap();
    let same_epoch = cache.read_manifest_observed(root.path());
    assert!(same_epoch.value.is_none() && same_epoch.qualified);
    assert_eq!(same_epoch.stamps, first.stamps);
    assert!(!same_epoch.stamps[0].is_current());
    assert_eq!(cache.manifest_reads(), 1);
    cache.begin_validation_epoch();
    let positive = cache.read_manifest_observed(root.path());
    assert_eq!(positive.value, Some(serde_json::json!({"name":"new"})));
    assert!(positive.qualified && positive.stamps[0].is_current());
    assert_eq!(cache.manifest_reads(), 2);
}

#[test]
fn invalid_utf8_and_directory_reads_stay_cold_even_on_metadata_valid_hits() {
    let root = tempfile::tempdir().unwrap();
    for (name, directory) in [("utf8", false), ("directory", true)] {
        let package = root.path().join(name);
        std::fs::create_dir_all(&package).unwrap();
        let path = package.join("package.json");
        if directory {
            std::fs::create_dir(&path).unwrap();
        } else {
            std::fs::write(&path, [0xff, 0xfe]).unwrap();
        }
        let kind = std::fs::read_to_string(&path).unwrap_err().kind();
        assert_ne!(kind, ErrorKind::NotFound);
        let mut cache = PackageSearchCache::default();
        for _ in 0..2 {
            let consumed = cache.read_manifest_observed(&package);
            assert!(consumed.value.is_none() && !consumed.qualified);
            assert_eq!(
                consumed.stamps,
                vec![InputStamp::observed_read_failure(path.clone(), kind)]
            );
            assert!(consumed.stamps[0].has_non_not_found_read_failure());
        }
        assert_eq!(cache.manifest_reads(), 1);
    }
}

#[test]
fn a_cached_missing_stamp_without_actual_read_provenance_cannot_qualify() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("package.json");
    let mut cache = PackageSearchCache::default();
    cache.begin_validation_epoch();
    cache.manifests.insert(
        path.clone(),
        CachedManifest {
            stamp: InputStamp::capture(path),
            value: None,
            last_used: 0,
            last_validated_epoch: cache.validation_epoch,
        },
    );
    let consumed = cache.read_manifest_observed(root.path());
    assert!(consumed.value.is_none() && !consumed.qualified && consumed.stamps.is_empty());
    assert_eq!(cache.manifest_reads(), 0);
}

#[test]
fn a_retained_failure_preserves_owner_and_the_original_metadata_validator() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("package.json");
    let owner = Arc::new(FactOwner {
        path: root.path().to_path_buf(),
        role: FactRole::Configuration,
    });
    let original = InputStamp::capture(&path).with_owner(owner.clone());
    let kind = std::fs::read_to_string(&path).unwrap_err().kind();
    let paired = original.clone().with_consumed_read_failure(kind);
    let retained = paired.retained_consumed_source().unwrap();
    assert_eq!(
        retained,
        InputStamp::observed_read_failure(path.clone(), kind).with_owner(owner)
    );
    assert_eq!(
        original.route_cache_is_current(),
        paired.route_cache_is_current()
    );
    assert_eq!(
        original.route_cache_is_current_with_cache(&mut Default::default()),
        paired.route_cache_is_current_with_cache(&mut Default::default())
    );
    assert!(retained.is_current());
    std::fs::write(&path, "{}").unwrap();
    assert!(!retained.is_current());
    assert_eq!(
        original.route_cache_is_current(),
        paired.route_cache_is_current()
    );
}
