//! Strict authority and actual filesystem counterexamples, without diagnostics.

use super::{
    Refusal,
    tests::{fixture, owned, run, source},
};
use crate::package_route::stamp::{Consumed, FactRole, InputStamp, SourceRevisionFact};
use std::path::PathBuf;
use vize_carton::FxHashMap;

#[test]
fn unknown_qualification_and_missing_known_bodies_cannot_be_recovered() {
    let (_root, host, target) = fixture();
    let stamps = vec![source(&host, b"host")];
    assert!(matches!(
        run(
            &stamps,
            false,
            &[host.clone()],
            (&host, b"host"),
            &FxHashMap::default(),
            &[]
        ),
        Err(Refusal::UnknownAuthority)
    ));
    assert!(matches!(
        run(
            &stamps,
            true,
            &[host.clone(), target.clone()],
            (&host, b"host"),
            &FxHashMap::default(),
            &[]
        ),
        Err(Refusal::UnknownAuthority)
    ));
    let legacy = InputStamp::capture_source(target.clone(), b"target");
    let stamps = vec![stamps[0].clone(), legacy];
    assert!(matches!(
        run(
            &stamps,
            true,
            &[host.clone(), target],
            (&host, b"host"),
            &FxHashMap::default(),
            &[]
        ),
        Err(Refusal::UnknownAuthority)
    ));
}

#[test]
fn unowned_or_unregistered_importer_facts_cannot_borrow_current_buffers() {
    let (_root, host, target) = fixture();
    for fact in [
        InputStamp::observed_source(target.clone(), b"target"),
        owned(
            InputStamp::observed_is_file(target.clone(), true),
            &target,
            FactRole::LocalImporter,
        ),
        owned(
            InputStamp::observed_source(host.clone(), b"host"),
            &target,
            FactRole::AuthoredSource,
        ),
    ] {
        let stamps = vec![source(&host, b"host"), fact];
        let overlays = FxHashMap::from_iter([(target.clone(), "supplied")]);
        assert!(matches!(
            run(
                &stamps,
                true,
                &[host.clone()],
                (&host, b"host"),
                &overlays,
                &[]
            ),
            Err(Refusal::UnknownAuthority)
        ));
    }
}

#[test]
fn actual_file_to_directory_cannot_lend_deletion_to_its_false_file_probe() {
    let (_root, host, target) = fixture();
    let own = owned(
        InputStamp::observed_is_file(target.clone(), true),
        &target,
        FactRole::AuthoredSource,
    );
    let stamps = vec![own, source(&host, b"host"), source(&target, b"target")];
    std::fs::remove_file(&target).unwrap();
    std::fs::create_dir(&target).unwrap();
    assert!(!target.is_file());
    assert!(
        matches!(run(&stamps, true, &[host.clone(), target.clone()], (&host, b"host"),
        &FxHashMap::default(), &[]), Err(Refusal::ChangedFact(path)) if path == target)
    );
}

#[test]
fn an_unchanged_non_not_found_read_failure_is_still_a_strict_native_refusal() {
    let (_root, host, target) = fixture();
    let directory = target.with_file_name("unreadable-as-text");
    std::fs::create_dir(&directory).unwrap();
    let kind = std::fs::read_to_string(&directory).unwrap_err().kind();
    assert_ne!(kind, std::io::ErrorKind::NotFound);
    let failed = owned(
        InputStamp::observed_read_failure(directory.clone(), kind),
        &host,
        FactRole::LocalImporter,
    );
    let now = failed.current_consumed_fact_with_source(None).unwrap();
    assert_eq!(failed, now);
    assert_eq!(
        failed.source_revision_fact(&now, &[]),
        SourceRevisionFact::Unchanged
    );
    let stamps = vec![source(&host, b"host"), failed];
    assert!(
        matches!(run(&stamps, true, &[host.clone()], (&host, b"host"),
        &FxHashMap::default(), &[]), Err(Refusal::ChangedFact(path)) if path == directory)
    );
}

#[test]
fn equal_length_equal_mtime_configuration_alias_and_package_body_changes_stay_cold() {
    let (_root, host, target) = fixture();
    for name in ["tsconfig.json", "aliases.json", "package.json"] {
        let path = target.with_file_name(name);
        let before = br#"{"paths":{"@/*":["one/*"]}}"#;
        let after = br#"{"paths":{"@/*":["two/*"]}}"#;
        std::fs::write(&path, before).unwrap();
        let old = std::fs::metadata(&path).unwrap();
        let config = owned(
            InputStamp::observed_source(path.clone(), before),
            host.parent().unwrap(),
            FactRole::Configuration,
        );
        std::fs::write(&path, after).unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(old.modified().unwrap()))
            .unwrap();
        let now = std::fs::metadata(&path).unwrap();
        assert_eq!(old.len(), now.len());
        assert_eq!(old.modified().unwrap(), now.modified().unwrap());
        let stamps = vec![source(&host, b"host"), config];
        // Even supplied old config bytes do not override the original disk read.
        let overlays = FxHashMap::from_iter([(path.clone(), std::str::from_utf8(before).unwrap())]);
        assert!(
            matches!(run(&stamps, true, &[host.clone()], (&host, b"host"),
            &overlays, &[]), Err(Refusal::ChangedFact(changed)) if changed == path)
        );
    }
}

#[test]
fn a_created_negative_probe_is_not_an_authored_revision_exception() {
    let (_root, host, target) = fixture();
    let missing = target.with_file_name("new-target.ts");
    let probe = owned(
        InputStamp::observed_is_file(missing.clone(), false),
        &host,
        FactRole::LocalImporter,
    );
    let stamps = vec![source(&host, b"host"), probe];
    std::fs::write(&missing, "new").unwrap();
    assert!(
        matches!(run(&stamps, true, &[host.clone()], (&host, b"host"),
        &FxHashMap::default(), &[]), Err(Refusal::ChangedFact(path)) if path == missing)
    );
}

#[test]
fn cache_miss_alias_configuration_provenance_cannot_borrow_a_known_deletion() {
    let (_root, host, target) = fixture();
    let config_probe = owned(
        InputStamp::observed_is_file(target.clone(), true),
        host.parent().unwrap(),
        FactRole::Configuration,
    );
    let stamps = vec![
        config_probe,
        source(&host, b"host"),
        source(&target, b"target"),
    ];
    std::fs::remove_file(&target).unwrap();
    assert!(
        matches!(run(&stamps, true, &[host.clone(), target.clone()], (&host, b"host"),
        &FxHashMap::default(), &[]), Err(Refusal::ChangedFact(path)) if path == target)
    );
}

#[cfg(unix)]
#[test]
fn an_actual_canonical_retarget_stays_cold_even_when_target_bytes_are_equal() {
    let (_root, host, target) = fixture();
    let other = target.with_file_name("other.ts");
    let alias = target.with_file_name("alias.ts");
    std::fs::write(&other, "target").unwrap();
    std::os::unix::fs::symlink(&target, &alias).unwrap();
    let probe = owned(
        InputStamp::observed_canonical_file(alias.clone(), target.clone(), true),
        &host,
        FactRole::LocalImporter,
    );
    let stamps = vec![source(&host, b"host"), source(&target, b"target"), probe];
    std::fs::remove_file(&alias).unwrap();
    std::os::unix::fs::symlink(&other, &alias).unwrap();
    assert!(
        matches!(run(&stamps, true, &[host.clone(), target], (&host, b"host"),
        &FxHashMap::default(), &[]), Err(Refusal::ChangedFact(path)) if path == alias)
    );
}

/// A finite guard-composition fixture, not a claim that a full native builder
/// has completed every owner. Actual source registration supplies membership.
pub(in crate::corsa_bridge::vue_dependencies_alias::context::cache::fingerprint) fn source_change_fixture()
-> (
    tempfile::TempDir,
    PathBuf,
    PathBuf,
    crate::corsa_bridge::vue_dependencies_alias::AliasContext,
    super::super::ContextFingerprint,
) {
    use super::super::ContextFingerprint;
    use crate::batch::virtual_project::VirtualProject;
    use crate::corsa_bridge::vue_dependencies_alias::AliasContext;
    let (storage, host, target) = fixture();
    let root = host.parent().unwrap().to_path_buf();
    let mut mirror = VirtualProject::new(&root).unwrap();
    mirror.register_path_with_content(&host, "host").unwrap();
    mirror
        .register_path_with_content(&target, "target")
        .unwrap();
    let context = AliasContext {
        project_root: root.clone(),
        aliases: Vec::new(),
        package_routes: FxHashMap::default(),
        route_inputs: vec![target.clone()],
        seed_paths: vec![host.clone(), target.clone()],
        graph_reused: false,
        mirror: Some(mirror),
        virtual_ts_options: Default::default(),
        query_surface: Default::default(),
    };
    let mut old = ContextFingerprint::capture(
        &host,
        "host",
        &FxHashMap::default(),
        Default::default(),
        &Default::default(),
        Some(&root),
        None,
    );
    old.include_requested_sources(&[(target.clone(), "target")]);
    old.include_consumed(Consumed {
        value: (),
        stamps: vec![source(&host, b"host"), source(&target, b"target")],
        qualified: true,
    });
    old.stamps.push(InputStamp::capture(target.clone()));
    (storage, host, target, context, old)
}
