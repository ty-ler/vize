//! Current validation returns the very fact used by the decision.
use super::{InputFact, InputStamp};

#[test]
fn a_returned_deleted_fact_is_not_a_later_filesystem_recapture() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("Target.ts");
    std::fs::write(&path, "export {};\n").unwrap();
    let old = InputStamp::observed_is_file(path.clone(), path.is_file());
    std::fs::remove_file(&path).unwrap();
    let actual = old.current_consumed_fact().unwrap();
    assert_eq!(actual.fact, Some(InputFact::IsFile(false)));
    assert!(old.changed_only_by_deleted_target(&actual, &path));
    std::fs::write(&path, "export const changed = 1;\n").unwrap();
    assert_eq!(actual.fact, Some(InputFact::IsFile(false)));
    assert!(!actual.is_current());
    assert!(old.is_current());
}

#[test]
fn original_utf8_read_failure_refuses_a_later_successful_manifest() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("package.json");
    let original = std::fs::read_to_string(&path).unwrap_err();
    let old = InputStamp::observed_read_failure(path.clone(), original.kind());
    assert!(old.is_current());
    let actual = old.current_consumed_fact().unwrap();
    assert_eq!(actual.fact, old.fact);
    std::fs::write(&path, "{\"name\":\"new-package\"}\n").unwrap();
    assert!(!old.is_current());
    assert!(!actual.is_current());
    let now = old.current_consumed_fact().unwrap();
    assert!(matches!(now.fact, Some(InputFact::ConsumedBody(_))));
    assert!(!old.changed_only_by_deleted_target(&now, &path));
}

#[test]
fn invalid_utf8_read_failure_is_preserved_as_its_own_observed_operation() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("tsconfig.json");
    std::fs::write(&path, [0xff, 0xfe]).unwrap();
    let original = std::fs::read_to_string(&path).unwrap_err();
    assert_eq!(original.kind(), std::io::ErrorKind::InvalidData);
    let fact = InputStamp::observed_read_failure(path.clone(), original.kind());
    assert!(fact.is_current());
    std::fs::write(&path, "{}\n").unwrap();
    assert!(!fact.is_current());
}

#[test]
fn ordinary_metadata_cannot_be_promoted_to_a_consumed_fact() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("tsconfig.json");
    std::fs::write(&path, "{}\n").unwrap();
    let ordinary = InputStamp::capture(&path);
    assert!(ordinary.current_consumed_fact().is_none());
}
