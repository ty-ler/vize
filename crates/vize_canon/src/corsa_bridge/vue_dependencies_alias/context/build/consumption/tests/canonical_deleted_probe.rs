//! Unexecuted primitive composition; no completed native builder authority.

use super::super::NativeFacts;
use crate::batch::virtual_project::dependency_scan::resolve_dependency_observed;
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp, SourceRevisionFact};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

struct Fixture {
    _storage: tempfile::TempDir,
    root: PathBuf,
    importer: PathBuf,
    target: PathBuf,
    body: InputStamp,
    canonical: InputStamp,
    probe: InputStamp,
}

fn importer_owner(path: &Path) -> Arc<FactOwner> {
    Arc::new(FactOwner {
        path: path.to_path_buf(),
        role: FactRole::LocalImporter,
    })
}

fn fixture() -> Fixture {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let importer = root.join("Host.ts");
    let target = root.join("Target.ts");
    std::fs::write(&importer, "import './Target.ts';").unwrap();
    std::fs::write(&target, "export const value = 1;").unwrap();
    let body = InputStamp::observed_source(target.clone(), &std::fs::read(&target).unwrap())
        .with_owner(Arc::new(FactOwner {
            path: target.clone(),
            role: FactRole::AuthoredSource,
        }));
    let canonical = InputStamp::observed_canonical_file(
        target.clone(),
        vize_carton::path::canonicalize_non_verbatim(&target),
        target.is_file(),
    )
    .with_owner(importer_owner(&importer));
    let mut facts = NativeFacts::new(true);
    let actual = resolve_dependency_observed("./Target.ts", &root, &root, &[]);
    assert_eq!(actual.value.0, Some(target.clone()));
    facts.record(actual, FactRole::LocalImporter, &importer);
    let actual = facts.finish(()).stamps;
    assert_eq!(actual.len(), 1);
    Fixture {
        _storage: storage,
        root,
        importer,
        target,
        body,
        canonical,
        probe: actual.into_iter().next().unwrap(),
    }
}

fn delete(fixture: &Fixture) -> (Vec<PathBuf>, Vec<InputStamp>) {
    std::fs::remove_file(&fixture.target).unwrap();
    let body = fixture
        .body
        .current_consumed_fact_with_source(None)
        .unwrap();
    assert_eq!(
        fixture.body.source_revision_fact(&body, &[]),
        SourceRevisionFact::DeletedBody
    );
    let deleted = vec![fixture.target.clone()];
    let canonical = fixture.canonical.current_consumed_fact().unwrap();
    assert_eq!(
        fixture.canonical.source_revision_fact(&canonical, &deleted),
        SourceRevisionFact::DeletedProbe
    );
    let probe = fixture.probe.current_consumed_fact().unwrap();
    (deleted, vec![canonical, probe])
}

fn resolver_prefix(fixture: &Fixture, owner: &Path) -> NativeFacts {
    let actual = resolve_dependency_observed("./Target.ts", &fixture.root, &fixture.root, &[]);
    assert!(actual.value.0.is_none());
    let mut facts = NativeFacts::new(true);
    facts.record(actual, FactRole::LocalImporter, owner);
    facts
}

#[test]
fn preflight_alone_and_preflight_is_file_cannot_supply_the_independent_prefix() {
    let fixture = fixture();
    let (deleted, carriers) = delete(&fixture);
    let previous = vec![fixture.canonical.clone(), fixture.probe.clone()];
    let mut facts = NativeFacts::new(true);
    // Both values are actual primitive preflight returns. Neither is an
    // independent resolver record, even if IsFile(false) precedes CanonicalFile.
    let carriers = vec![
        carriers.get(1).unwrap().clone(),
        carriers.first().unwrap().clone(),
    ];
    facts.retain_previous_with_validated_deleted(&previous, &[], &[], &[], &deleted, &carriers);
    assert_eq!(facts.witness().stamps, previous);
    assert!(!facts.witness().stamps.iter().all(InputStamp::is_current));
}

#[test]
fn exact_owner_and_actual_deleted_body_are_required_even_with_a_new_negative() {
    let fixture = fixture();
    let (deleted, carriers) = delete(&fixture);
    let old = std::slice::from_ref(&fixture.canonical);
    let mut other = resolver_prefix(&fixture, &fixture.root.join("Other.ts"));
    other.retain_previous_with_validated_deleted(old, &[], &[], &[], &deleted, &carriers);
    assert!(other.witness().stamps.contains(&fixture.canonical));
    assert!(!other.witness().stamps.contains(carriers.first().unwrap()));
    let mut unproved = resolver_prefix(&fixture, &fixture.importer);
    unproved.retain_previous_with_validated_deleted(
        old,
        &[],
        &[],
        std::slice::from_ref(&fixture.target),
        &[],
        &carriers,
    );
    assert!(unproved.witness().stamps.contains(&fixture.canonical));
    assert!(
        !unproved
            .witness()
            .stamps
            .contains(carriers.first().unwrap())
    );
}

#[test]
fn a_retained_old_negative_is_outside_the_carrier_promotion_cutoff() {
    let fixture = fixture();
    let (deleted, carriers) = delete(&fixture);
    let previous = vec![carriers.get(1).unwrap().clone(), fixture.canonical.clone()];
    let mut facts = NativeFacts::new(true);
    facts.retain_previous_with_validated_deleted(&previous, &[], &[], &[], &deleted, &carriers);
    assert_eq!(facts.witness().stamps, previous);
    assert!(!facts.witness().stamps.contains(carriers.first().unwrap()));
}

#[test]
fn actual_non_not_found_body_error_cannot_authorize_a_false_canonical_record() {
    let fixture = fixture();
    std::fs::remove_file(&fixture.target).unwrap();
    std::fs::create_dir(&fixture.target).unwrap();
    let body = fixture
        .body
        .current_consumed_fact_with_source(None)
        .unwrap();
    assert!(body.has_non_not_found_read_failure());
    assert_eq!(
        fixture.body.source_revision_fact(&body, &[]),
        SourceRevisionFact::Incompatible
    );
    let current = fixture.canonical.current_consumed_fact().unwrap();
    let mut facts = resolver_prefix(&fixture, &fixture.importer);
    facts.retain_previous_with_validated_deleted(
        std::slice::from_ref(&fixture.canonical),
        &[],
        &[],
        std::slice::from_ref(&fixture.target),
        &[],
        std::slice::from_ref(&current),
    );
    assert!(facts.witness().stamps.contains(&fixture.canonical));
    assert!(!facts.witness().stamps.contains(&current));
}

#[test]
#[cfg(unix)]
fn actual_retarget_is_never_a_canonical_false_carrier_for_the_deleted_source() {
    let fixture = fixture();
    let alias = fixture.root.join("selected.ts");
    std::os::unix::fs::symlink(&fixture.target, &alias).unwrap();
    let old = InputStamp::observed_canonical_file(
        alias.clone(),
        vize_carton::path::canonicalize_non_verbatim(&alias),
        alias.is_file(),
    )
    .with_owner(importer_owner(&fixture.importer));
    let (deleted, _) = delete(&fixture);
    let replacement = fixture.root.join("replacement.ts");
    std::fs::write(&replacement, "export const value = 1;").unwrap();
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(&replacement, &alias).unwrap();
    let current = old.current_consumed_fact().unwrap();
    assert_eq!(
        old.source_revision_fact(&current, &deleted),
        SourceRevisionFact::Incompatible
    );
    let mut facts = NativeFacts::new(true);
    let actual = resolve_dependency_observed("./selected.ts", &fixture.root, &fixture.root, &[]);
    assert_eq!(actual.value.0, Some(alias));
    facts.record(actual, FactRole::LocalImporter, &fixture.importer);
    facts.retain_previous_with_validated_deleted(
        std::slice::from_ref(&old),
        &[],
        &[],
        &[],
        &deleted,
        std::slice::from_ref(&current),
    );
    assert!(facts.witness().stamps.contains(&old));
    assert!(!facts.witness().stamps.contains(&current));
}
