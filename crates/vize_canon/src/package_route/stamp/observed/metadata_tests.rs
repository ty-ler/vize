use super::{InputFact, InputStamp};

#[test]
fn original_metadata_length_refuses_a_later_budget_changing_length() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("source.ts");
    std::fs::write(&path, "export {};\n").unwrap();
    let original = std::fs::metadata(&path)
        .map(|metadata| metadata.len())
        .map_err(|error| error.kind());
    let fact = InputStamp::observed_metadata_len(path.clone(), original);
    assert!(fact.is_current());
    let current = fact.current_consumed_fact().unwrap();
    assert_eq!(current.fact, fact.fact);
    std::fs::write(&path, "export const changed = 1;\n").unwrap();
    assert!(!fact.is_current());
    assert!(!current.is_current());
}

#[test]
fn original_metadata_failure_refuses_later_success() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("source.ts");
    let original = std::fs::metadata(&path)
        .map(|metadata| metadata.len())
        .map_err(|error| error.kind());
    assert!(original.is_err());
    let fact = InputStamp::observed_metadata_len(path.clone(), original);
    assert!(fact.is_current());
    std::fs::write(&path, "export {};\n").unwrap();
    assert!(!fact.is_current());
}

#[cfg(unix)]
#[test]
fn canonical_retarget_returns_the_actual_partial_identity_without_a_file_predicate() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let first = root.join("first.ts");
    let other = root.join("other.ts");
    let link = root.join("link.ts");
    std::fs::write(&first, "export {};\n").unwrap();
    std::fs::write(&other, "export {};\n").unwrap();
    std::os::unix::fs::symlink(&first, &link).unwrap();
    let original = vize_carton::path::canonicalize_non_verbatim(&link);
    let fact =
        InputStamp::observed_canonical_file(link.clone(), original.clone(), original.is_file());
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&other, &link).unwrap();
    let current = fact.current_consumed_fact().unwrap();
    assert_eq!(current.fact, Some(InputFact::CanonicalPath(other)));
    assert!(!fact.is_current());
    assert!(!fact.changed_only_by_deleted_target(&current, &first));
}
