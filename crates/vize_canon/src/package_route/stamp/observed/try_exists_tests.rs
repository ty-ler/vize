//! Supplied original try_exists Result is distinct from a lossy exists bool.
use super::{InputFact, InputStamp};

#[test]
fn missing_directory_and_later_creation_validate_the_exact_original_result() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("selected");
    let result = path.try_exists().map_err(|error| error.kind());
    assert_eq!(result, Ok(false));
    let old = InputStamp::observed_try_exists(path.clone(), result);
    assert_eq!(
        old.current_consumed_fact().unwrap().fact,
        Some(InputFact::TryExists(result))
    );
    assert!(old.is_current());
    std::fs::create_dir(&path).unwrap();
    assert!(!old.is_current());
    let now = old.current_consumed_fact().unwrap();
    assert_eq!(now.fact, Some(InputFact::TryExists(Ok(true))));
    assert!(now.is_current());
    assert!(!path.is_file());
}

#[test]
fn actual_errors_are_preserved_and_never_collapsed_into_ok_false() {
    let storage = tempfile::tempdir().unwrap();
    let path = storage.path().join("invalid\0selected");
    let actual = path.try_exists().unwrap_err().kind();
    let old = InputStamp::observed_try_exists(path.clone(), Err(actual));
    assert_eq!(
        old.current_consumed_fact().unwrap().fact,
        Some(InputFact::TryExists(Err(actual)))
    );
    assert_ne!(old, InputStamp::observed_try_exists(path, Ok(false)));
}
