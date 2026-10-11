//! Actual resolver/validation records; unexecuted primitive composition laws.

use super::super::NativeFacts;
use crate::batch::virtual_project::dependency_scan::resolve_dependency_observed;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp, SourceRevisionFact};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vize_carton::FxHashSet;

struct Fixture {
    _storage: tempfile::TempDir,
    root: PathBuf,
    importer: PathBuf,
    target: PathBuf,
    body: InputStamp,
}

fn owner(path: &Path, role: FactRole) -> Arc<FactOwner> {
    Arc::new(FactOwner {
        path: path.to_path_buf(),
        role,
    })
}

fn fixture() -> Fixture {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let importer = root.join("Host.ts");
    let target = root.join("Target.ts");
    std::fs::write(&importer, "import './Target.ts';").unwrap();
    std::fs::write(&target, "export const value = 1;").unwrap();
    let bytes = std::fs::read(&target).unwrap();
    let body = InputStamp::observed_source(target.clone(), &bytes)
        .with_owner(owner(&target, FactRole::AuthoredSource));
    Fixture {
        _storage: storage,
        root,
        importer,
        target,
        body,
    }
}

fn resolve(fixture: &Fixture, importer: &Path, present: bool) -> Consumed<()> {
    let actual = resolve_dependency_observed("./Target.ts", &fixture.root, &fixture.root, &[]);
    assert_eq!(
        actual.value,
        (
            present.then(|| fixture.target.clone()),
            vec![fixture.target.clone()]
        )
    );
    let mut facts = NativeFacts::new(true);
    facts.record(actual, FactRole::LocalImporter, importer);
    let packet = facts.finish(());
    assert!(packet.qualified);
    assert_eq!(packet.stamps.len(), 1);
    packet
}

fn deleted(fixture: &Fixture) -> Vec<PathBuf> {
    // This invokes the original consumed-body byte read once. A false probe
    // or a caller's removed list cannot create this DeletedBody proof.
    let now = fixture
        .body
        .current_consumed_fact_with_source(None)
        .unwrap();
    assert_eq!(
        fixture.body.source_revision_fact(&now, &[]),
        SourceRevisionFact::DeletedBody
    );
    vec![fixture.target.clone()]
}

fn retain(
    fixture: &Fixture,
    actual: Option<&Consumed<()>>,
    previous: &[InputStamp],
    removed: &[PathBuf],
    proven: &[PathBuf],
) -> Consumed<()> {
    let mut facts = NativeFacts::new(true);
    if let Some(actual) = actual {
        facts.record_view(actual, FactRole::LocalImporter, &fixture.importer);
    }
    // Completion is an explicit composition input, not an executed callback.
    facts.retain_previous_with_deleted(
        previous,
        std::slice::from_ref(&fixture.importer),
        &[],
        removed,
        proven,
    );
    facts.finish(())
}

#[test]
fn actual_resolver_negative_replaces_the_exact_deleted_probe_and_refuses_reappearance() {
    let fixture = fixture();
    let before = resolve(&fixture, &fixture.importer, true);
    let old = &before.stamps[0];
    std::fs::remove_file(&fixture.target).unwrap();
    let proven = deleted(&fixture);
    let after = resolve(&fixture, &fixture.importer, false);
    assert_eq!(
        old.expected_deleted_probe_replacement(&FxHashSet::from_iter(proven.iter().cloned())),
        Some(after.stamps[0].clone())
    );
    let retained = retain(&fixture, Some(&after), &before.stamps, &[], &proven);
    assert_eq!(retained.stamps, after.stamps);
    assert!(!retained.stamps.contains(old));
    assert!(retained.stamps.iter().all(InputStamp::is_current));
    std::fs::write(&fixture.target, "export const value = 1;").unwrap();
    assert!(!retained.stamps.iter().all(InputStamp::is_current));
}

#[test]
fn absent_new_records_other_owner_and_unproved_removal_keep_the_old_probe() {
    let fixture = fixture();
    let before = resolve(&fixture, &fixture.importer, true);
    std::fs::remove_file(&fixture.target).unwrap();
    let proven = deleted(&fixture);
    let after = resolve(&fixture, &fixture.importer, false);
    let other = resolve(&fixture, &fixture.root.join("Other.ts"), false);
    assert_ne!(after.stamps[0].owner(), other.stamps[0].owner());
    let no_records = retain(&fixture, None, &before.stamps, &[], &proven);
    assert_eq!(no_records.stamps, before.stamps);
    let other_owner = retain(&fixture, Some(&other), &before.stamps, &[], &proven);
    assert!(other_owner.stamps.contains(&before.stamps[0]));
    let unproved = retain(
        &fixture,
        Some(&after),
        &before.stamps,
        std::slice::from_ref(&fixture.target),
        &[],
    );
    assert!(unproved.stamps.contains(&before.stamps[0]));
    assert!(!unproved.stamps.iter().all(InputStamp::is_current));
}

#[test]
fn a_prior_retained_negative_cannot_grant_replacement_in_the_same_pass() {
    let fixture = fixture();
    let positive = resolve(&fixture, &fixture.importer, true);
    std::fs::remove_file(&fixture.target).unwrap();
    let proven = deleted(&fixture);
    let negative = resolve(&fixture, &fixture.importer, false);
    let mut previous = negative.stamps;
    previous.extend(positive.stamps);
    // The negative enters the hash bucket first, but was not a new record
    // before retention's actual_count cutoff. Both old facts must survive.
    let retained = retain(&fixture, None, &previous, &[], &proven);
    assert_eq!(retained.stamps, previous);
    assert!(!retained.stamps.iter().all(InputStamp::is_current));
}

#[test]
fn an_actual_directory_read_error_cannot_prove_source_deletion() {
    let fixture = fixture();
    let before = resolve(&fixture, &fixture.importer, true);
    std::fs::remove_file(&fixture.target).unwrap();
    std::fs::create_dir(&fixture.target).unwrap();
    let now = fixture
        .body
        .current_consumed_fact_with_source(None)
        .unwrap();
    assert!(now.has_non_not_found_read_failure());
    assert_eq!(
        fixture.body.source_revision_fact(&now, &[]),
        SourceRevisionFact::Incompatible
    );
    let after = resolve(&fixture, &fixture.importer, false);
    let retained = retain(
        &fixture,
        Some(&after),
        &before.stamps,
        std::slice::from_ref(&fixture.target),
        &[],
    );
    assert!(retained.stamps.contains(&before.stamps[0]));
    assert!(!retained.stamps.iter().all(InputStamp::is_current));
}

fn canonical(fixture: &Fixture, path: &Path) -> InputStamp {
    let selected = vize_carton::path::canonicalize_non_verbatim(path);
    let is_file = selected.is_file();
    InputStamp::observed_canonical_file(path.to_path_buf(), selected, is_file)
        .with_owner(owner(&fixture.importer, FactRole::LocalImporter))
}

#[test]
fn exact_canonical_validation_record_can_replace_only_its_deleted_selection() {
    let fixture = fixture();
    let old = canonical(&fixture, &fixture.target);
    std::fs::remove_file(&fixture.target).unwrap();
    let proven = deleted(&fixture);
    let actual = old.current_consumed_fact().unwrap();
    assert_eq!(
        old.expected_deleted_probe_replacement(&FxHashSet::from_iter(proven.iter().cloned())),
        Some(actual.clone())
    );
    // Primitive return only: no qualified carrier or completed operation is
    // fabricated, and this does not certify native replacement authority.
    let mut facts = NativeFacts::new(true);
    facts.insert(actual.clone());
    facts.retain_previous_with_deleted(std::slice::from_ref(&old), &[], &[], &[], &proven);
    assert_eq!(facts.witness().stamps, vec![actual.clone()]);
    assert!(actual.is_current());
    std::fs::write(&fixture.target, "export const value = 1;").unwrap();
    assert!(!actual.is_current());
}

#[test]
#[cfg(unix)]
fn an_actual_canonical_retarget_cannot_replace_the_old_deleted_selection() {
    let fixture = fixture();
    let link = fixture.root.join("selected.ts");
    std::os::unix::fs::symlink(&fixture.target, &link).unwrap();
    let old = canonical(&fixture, &link);
    std::fs::remove_file(&fixture.target).unwrap();
    let proven = deleted(&fixture);
    let replacement = fixture.root.join("replacement.ts");
    std::fs::write(&replacement, "export const value = 1;").unwrap();
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&replacement, &link).unwrap();
    let retarget = old.current_consumed_fact().unwrap();
    assert_ne!(
        old.expected_deleted_probe_replacement(&FxHashSet::from_iter(proven.iter().cloned())),
        Some(retarget.clone())
    );
    let mut facts = NativeFacts::new(true);
    facts.insert(retarget.clone());
    facts.retain_previous_with_deleted(std::slice::from_ref(&old), &[], &[], &[], &proven);
    assert_eq!(facts.witness().stamps, vec![retarget, old]);
}

#[test]
fn actual_unsupported_and_error_records_never_gain_deleted_probe_keys() {
    let fixture = fixture();
    let unsupported = InputStamp::observed_exists(fixture.target.clone(), fixture.target.exists())
        .with_owner(owner(&fixture.importer, FactRole::LocalImporter));
    let invalid = fixture.root.join("invalid\0probe.ts");
    let actual_error = invalid.try_exists().unwrap_err().kind();
    let error = InputStamp::observed_try_exists(invalid, Err(actual_error))
        .with_owner(owner(&fixture.importer, FactRole::LocalImporter));
    std::fs::remove_file(&fixture.target).unwrap();
    let proven = deleted(&fixture);
    let deleted = FxHashSet::from_iter(proven.iter().cloned());
    for old in [unsupported, error] {
        assert!(old.expected_deleted_probe_replacement(&deleted).is_none());
        let actual = old.current_consumed_fact().unwrap();
        let mut facts = NativeFacts::new(true);
        facts.insert(actual);
        facts.retain_previous_with_deleted(std::slice::from_ref(&old), &[], &[], &[], &proven);
        assert!(facts.witness().stamps.contains(&old));
    }
}
