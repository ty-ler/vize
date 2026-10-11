use super::{FactOwner, FactRole, InputStamp};
use crate::package_route::stamp::InputStampCache;
use std::sync::Arc;

#[test]
fn original_missing_file_decision_does_not_acknowledge_a_later_created_target() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("target.ts");
    let original = path.is_file();
    assert!(!original);
    let fact = InputStamp::observed_is_file(path.clone(), original);
    std::fs::write(&path, "export const value = 1;").unwrap();
    assert!(!fact.is_current());
    assert!(InputStamp::capture(&path).is_current());
}

#[test]
fn exists_and_file_predicates_preserve_directory_and_broken_link_distinctions() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("target.ts");
    std::fs::create_dir(&directory).unwrap();
    let exists = InputStamp::observed_exists(directory.clone(), directory.exists());
    let file = InputStamp::observed_is_file(directory.clone(), directory.is_file());
    assert!(exists.is_current());
    assert!(file.is_current());
    std::fs::remove_dir(&directory).unwrap();
    assert!(!exists.is_current());
    assert!(file.is_current());
}

#[cfg(unix)]
#[test]
fn selected_canonical_identity_refuses_same_byte_symlink_retargeting() {
    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("first.ts");
    let second = root.path().join("second.ts");
    let link = root.path().join("link.ts");
    std::fs::write(&first, "export const value = 1;").unwrap();
    std::fs::write(&second, "export const value = 1;").unwrap();
    std::os::unix::fs::symlink(&first, &link).unwrap();
    let selected = vize_carton::path::canonicalize_non_verbatim(&link);
    let fact =
        InputStamp::observed_canonical_file(link.clone(), selected.clone(), selected.is_file());
    assert!(fact.is_current());
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&second, &link).unwrap();
    assert!(!fact.is_current());
    let now = vize_carton::path::canonicalize_non_verbatim(&link);
    let current = InputStamp::observed_canonical_file(link.clone(), now.clone(), now.is_file());
    assert!(!fact.changed_only_by_deleted_target(&current, &first));
    assert!(!fact.changed_only_by_deleted_target(&current, &second));
    std::fs::remove_file(&first).unwrap();
    assert!(!fact.changed_only_by_deleted_target(&current, &first));
}

#[test]
fn source_owner_metadata_does_not_reject_current_bytes_or_acknowledge_changed_bytes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("owner.ts");
    let body = b"export const value = 1;";
    std::fs::write(&path, body).unwrap();
    let owner = Arc::new(FactOwner {
        path: path.clone(),
        role: FactRole::AuthoredSource,
    });
    let stamp = InputStamp::capture_source(path.clone(), body).with_owner(owner.clone());
    let mut observed = InputStampCache::default();
    observed.capture(&path);
    assert!(stamp.is_current_with_cache(&mut observed));
    assert_eq!(stamp.owner(), Some(owner.as_ref()));
    std::fs::write(&path, "export const value = 2;").unwrap();
    assert!(!stamp.is_current_with_cache(&mut observed));
}

#[test]
fn repeated_consumed_bodies_remain_independent_even_with_the_same_path_and_mtime() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("config.json");
    let old = b"{\"strict\":true }";
    let new = b"{\"strict\":false}";
    assert_eq!(old.len(), new.len());
    std::fs::write(&path, old).unwrap();
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let first = InputStamp::capture_source(&path, old);
    std::fs::write(&path, new).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let second = InputStamp::capture_source(&path, new);
    let facts = [first, second];
    assert!(!facts[0].is_current());
    assert!(facts[1].is_current());
    assert!(!facts.iter().all(InputStamp::is_current));
}

#[cfg(unix)]
#[test]
fn broken_link_is_not_a_file_and_creation_changes_the_original_decision() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("absent.ts");
    let link = root.path().join("link.ts");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let fact = InputStamp::observed_is_file(link.clone(), link.is_file());
    assert!(fact.is_current());
    std::fs::write(&target, "export const value = 1;").unwrap();
    assert!(!fact.is_current());
}
