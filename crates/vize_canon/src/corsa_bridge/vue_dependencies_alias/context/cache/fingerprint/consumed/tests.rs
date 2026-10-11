//! Authored operation laws; these do not execute a native diagnostic request.
mod canonical_deleted_probe;

use super::{AuthoredInputs, Refusal, SourceChanges, validate};
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vize_carton::FxHashMap;

pub(super) fn owned(stamp: InputStamp, path: &Path, role: FactRole) -> InputStamp {
    stamp.with_owner(Arc::new(FactOwner {
        path: path.to_path_buf(),
        role,
    }))
}

pub(super) fn source(path: &Path, body: &[u8]) -> InputStamp {
    owned(
        InputStamp::observed_source(path.to_path_buf(), body),
        path,
        FactRole::AuthoredSource,
    )
}

pub(super) fn run<'a>(
    stamps: &[InputStamp],
    qualified: bool,
    known: &[PathBuf],
    host: (&'a Path, &'a [u8]),
    overlays: &'a FxHashMap<PathBuf, &'a str>,
    requested: &'a [(PathBuf, &'a str)],
) -> Result<Consumed<SourceChanges>, Refusal> {
    validate(
        stamps,
        qualified,
        &known.iter().cloned().collect(),
        &AuthoredInputs {
            host_path: host.0,
            host_body: host.1,
            overlays,
            requested,
        },
    )
}

pub(super) fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let directory = vize_carton::path::canonicalize_non_verbatim(root.path());
    let host = directory.join("host.vue");
    let target = directory.join("target.ts");
    std::fs::write(&host, "host").unwrap();
    std::fs::write(&target, "target").unwrap();
    (root, host, target)
}

#[test]
fn exact_host_then_overlay_then_last_requested_bytes_preserve_the_original_view() {
    let (_root, host, target) = fixture();
    let requested_path = target.with_file_name("requested.ts");
    std::fs::write(&requested_path, "different disk").unwrap();
    let stamps = vec![
        source(&host, b"host unsaved"),
        source(&target, b"overlay"),
        source(&requested_path, b"last requested"),
    ];
    let overlays = FxHashMap::from_iter([
        (host.clone(), "ignored host overlay"),
        (target.clone(), "overlay"),
    ]);
    let requested = vec![
        (host.clone(), "ignored host request"),
        (target.clone(), "ignored overlay request"),
        (requested_path.clone(), "first requested"),
        (requested_path.clone(), "last requested"),
    ];
    let result = run(
        &stamps,
        true,
        &[host.clone(), target, requested_path],
        (&host, b"host unsaved"),
        &overlays,
        &requested,
    )
    .unwrap();
    assert_eq!(result.stamps, stamps);
    assert!(result.value.changed.is_empty());
    assert!(result.value.deleted.is_empty());
    assert!(result.qualified);
}

#[test]
fn consumed_order_is_preserved_and_changed_legacy_entries_are_not_a_strong_gate() {
    let (_root, host, target) = fixture();
    let legacy = InputStamp::capture_source(target.clone(), b"target");
    let body = source(&host, b"host");
    let probe = owned(
        InputStamp::observed_is_file(target.clone(), true),
        &host,
        FactRole::LocalImporter,
    );
    std::fs::write(&target, "changed legacy disk").unwrap();
    assert!(!legacy.is_current());
    let stamps = vec![probe.clone(), legacy, body.clone()];
    let result = run(
        &stamps,
        true,
        &[host.clone()],
        (&host, b"host"),
        &FxHashMap::default(),
        &[],
    )
    .unwrap();
    assert_eq!(result.stamps, vec![probe, body]);
    assert!(result.value.changed.is_empty());
}

#[test]
fn current_authored_revisions_return_sorted_sources_without_mutating_old_facts() {
    let (_root, host, target) = fixture();
    let stamps = vec![source(&target, b"target"), source(&host, b"host")];
    let old = stamps.clone();
    let overlays = FxHashMap::from_iter([(target.clone(), "new overlay")]);
    let result = run(
        &stamps,
        true,
        &[host.clone(), target.clone()],
        (&host, b"new host"),
        &overlays,
        &[],
    )
    .unwrap();
    let mut changed = vec![host.clone(), target.clone()];
    changed.sort();
    assert_eq!(result.value.changed, changed);
    assert!(result.value.deleted.is_empty());
    assert_eq!(
        result.stamps,
        vec![source(&target, b"new overlay"), source(&host, b"new host")]
    );
    assert_eq!(stamps, old);
}

#[test]
fn actual_missing_body_precedes_own_and_retained_importer_predicates_in_any_input_order() {
    let (_root, host, target) = fixture();
    let probe = owned(
        InputStamp::observed_canonical_file(target.clone(), target.clone(), true),
        &host,
        FactRole::LocalImporter,
    );
    let own = owned(
        InputStamp::observed_is_file(target.clone(), true),
        &target,
        FactRole::AuthoredSource,
    );
    let stamps = vec![
        probe,
        own,
        source(&target, b"target"),
        source(&host, b"host"),
    ];
    std::fs::remove_file(&target).unwrap();
    let result = run(
        &stamps,
        true,
        &[host.clone(), target.clone()],
        (&host, b"host"),
        &FxHashMap::default(),
        &[],
    )
    .unwrap();
    assert_eq!(result.value.changed, vec![target.clone()]);
    assert_eq!(result.value.deleted, vec![target.clone()]);
    assert_eq!(
        result.stamps,
        vec![
            owned(
                InputStamp::observed_canonical_file(target.clone(), target.clone(), false),
                &host,
                FactRole::LocalImporter
            ),
            owned(
                InputStamp::observed_is_file(target.clone(), false),
                &target,
                FactRole::AuthoredSource
            ),
            owned(
                InputStamp::observed_read_failure(target.clone(), std::io::ErrorKind::NotFound),
                &target,
                FactRole::AuthoredSource
            ),
            source(&host, b"host")
        ]
    );
}

#[test]
fn an_actual_current_open_buffer_prevents_a_disk_deletion_exception() {
    let (_root, host, target) = fixture();
    let probe = owned(
        InputStamp::observed_is_file(target.clone(), true),
        &host,
        FactRole::LocalImporter,
    );
    let stamps = vec![probe, source(&target, b"target"), source(&host, b"host")];
    std::fs::remove_file(&target).unwrap();
    let overlays = FxHashMap::from_iter([(target.clone(), "still open")]);
    assert!(
        matches!(run(&stamps, true, &[host.clone(), target.clone()], (&host, b"host"),
        &overlays, &[]), Err(Refusal::ChangedFact(path)) if path == target)
    );
}

#[test]
fn actual_byte_read_does_not_silently_become_a_utf8_builder_read() {
    let (_root, host, target) = fixture();
    let stamps = vec![source(&host, b"host"), source(&target, b"target")];
    std::fs::write(&target, [0xff, 0xfe]).unwrap();
    let result = run(
        &stamps,
        true,
        &[host.clone(), target.clone()],
        (&host, b"host"),
        &FxHashMap::default(),
        &[],
    )
    .unwrap();
    assert_eq!(result.value.changed, vec![target.clone()]);
    assert!(result.value.deleted.is_empty());
    assert_eq!(
        result.stamps,
        vec![source(&host, b"host"), source(&target, &[0xff, 0xfe])]
    );
    // The original UTF-8 producer still fails; this guard is not builder credit.
    assert_eq!(
        std::fs::read_to_string(&target).unwrap_err().kind(),
        std::io::ErrorKind::InvalidData
    );
}

#[test]
fn same_owner_read_failure_uses_original_utf8_validation_and_refuses_recreation() {
    let (_root, host, target) = fixture();
    let absent = target.with_file_name("previously-missing.ts");
    let failed = owned(
        InputStamp::observed_read_failure(absent.clone(), std::io::ErrorKind::NotFound),
        &host,
        FactRole::LocalImporter,
    );
    let stamps = vec![source(&host, b"host"), failed.clone()];
    let unchanged = run(
        &stamps,
        true,
        &[host.clone()],
        (&host, b"host"),
        &FxHashMap::default(),
        &[],
    )
    .unwrap();
    assert_eq!(unchanged.stamps, stamps);
    std::fs::write(&absent, "new readable source").unwrap();
    assert!(
        matches!(run(&stamps, true, &[host.clone()], (&host, b"host"),
        &FxHashMap::default(), &[]), Err(Refusal::ChangedFact(path)) if path == absent)
    );
}
