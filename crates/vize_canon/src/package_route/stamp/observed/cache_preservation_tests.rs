use super::InputStamp;

#[test]
fn consumed_body_does_not_replace_the_original_route_cache_validator() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("package.json");
    let original = b"{\"name\":\"first\"}";
    let stale_read = b"{\"name\":\"other\"}";
    std::fs::write(&path, original).unwrap();
    let ordinary = InputStamp::capture(&path);
    let paired = ordinary.clone().with_consumed_source(stale_read);
    assert!(ordinary.is_current());
    assert!(paired.route_cache_is_current());
    assert!(!paired.retained_consumed_source().unwrap().is_current());
    let mut cache = super::super::InputStampCache::default();
    assert_eq!(
        ordinary.is_current_with_cache(&mut cache),
        paired.route_cache_is_current_with_cache(&mut cache)
    );
}

#[test]
fn consumed_only_negative_probe_does_not_change_legacy_cache_eligibility() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("priority.ts");
    let original = path.is_file();
    let stamp = InputStamp::observed_is_file(path.clone(), original);
    std::fs::write(&path, "export const value = 1;").unwrap();
    assert!(!stamp.is_current());
    assert!(stamp.route_cache_is_current());
    assert!(stamp.route_cache_is_current_with_cache(&mut Default::default()));
}

#[test]
fn exact_deleted_selection_requires_the_actual_current_missing_identity() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("deleted.ts");
    std::fs::write(&path, "export const value = 1;").unwrap();
    let old = InputStamp::observed_canonical_file(path.clone(), path.clone(), true);
    std::fs::remove_file(&path).unwrap();
    let current = vize_carton::path::canonicalize_non_verbatim(&path);
    let now = InputStamp::observed_canonical_file(path.clone(), current.clone(), current.is_file());
    assert!(old.changed_only_by_deleted_target(&now, &path));
    assert!(!old.changed_only_by_deleted_target(&now, &root.path().join("other.ts")));
    let unknown = InputStamp::capture(&path);
    assert!(!old.changed_only_by_deleted_target(&unknown, &path));
}
