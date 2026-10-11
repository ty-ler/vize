//! Conditional frontier metadata laws; configuration authority is supplied by
//! the test, rather than inferred from filesystem timestamps or target visits.

use super::observed::WalkFacts;
use super::{DependencyConsumption, FxHashSet, Path, PathBuf, VirtualProject};
use crate::package_route::stamp::{
    Consumed, FactOwner, FactRole, InputStamp, Shared, SourceRevisionFact,
};

#[expect(clippy::disallowed_types, reason = "whole source fixture packets")]
#[expect(clippy::disallowed_macros, reason = "whole source fixture packets")]
fn packet(project: &VirtualProject) -> String {
    let files = project
        .virtual_files_sorted()
        .into_iter()
        .map(|file| {
            (
                file.original_path.clone(),
                file.virtual_path.clone(),
                file.content.clone(),
                format!("{:?}", file.source_map),
                project.original_contents.get(&file.virtual_path).cloned(),
            )
        })
        .collect::<Vec<_>>();
    let mut edges = project
        .dependency_edges
        .iter()
        .map(|(owner, targets)| {
            let mut targets = targets.iter().cloned().collect::<Vec<_>>();
            targets.sort();
            (owner.clone(), targets)
        })
        .collect::<Vec<_>>();
    edges.sort();
    let mut inbound = project.dependency_inbound.iter().collect::<Vec<_>>();
    inbound.sort();
    format!(
        "{:?}",
        (
            files,
            edges,
            inbound,
            project.registered_original_paths_sorted(),
            project.diagnostics(),
        )
    )
}

fn write(root: &Path, name: &str, source: impl AsRef<[u8]>) -> PathBuf {
    let path = root.join(name);
    std::fs::write(&path, source).unwrap();
    path
}

fn project(root: &Path, sources: &[PathBuf]) -> VirtualProject {
    let mut project = VirtualProject::new(root).unwrap();
    project.set_session_script_registration(true);
    for source in sources {
        project.register_path(source).unwrap();
    }
    project
}

fn reconcile(project: &mut VirtualProject, sources: &[PathBuf]) -> Consumed<Vec<PathBuf>> {
    project
        .register_reachable_dependencies_from_consumed(
            sources,
            Consumed {
                value: Vec::new(),
                stamps: Vec::new(),
                qualified: true,
            },
        )
        .unwrap()
}

#[test]
fn zero_edge_owners_are_completed_without_acknowledging_unwalked_targets() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let first = write(&root, "First.ts", "export const first = 1;\n");
    let second = write(&root, "Second.ts", "export const second = 2;\n");
    let untouched = write(&root, "Untouched.ts", "export const untouched = 3;\n");
    let all = [first.clone(), second.clone(), untouched.clone()];
    let frontier = [first.clone(), second.clone()];
    let mut original = project(&root, &all);
    let mut candidate = project(&root, &all);
    original
        .register_reachable_dependencies_from(&frontier)
        .unwrap();
    let consumed = reconcile(&mut candidate, &frontier);
    assert_eq!(consumed.value, [second, first]);
    assert!(!consumed.value.contains(&untouched));
    assert!(consumed.qualified);
    assert_eq!(packet(&candidate), packet(&original));
}

#[test]
fn a_missing_requested_owner_refuses_qualification_and_keeps_original_result() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let first = write(&root, "First.ts", "export const first = 1;\n");
    let missing = root.join("Missing.ts");
    let frontier = [first.clone(), missing];
    let mut original = project(&root, std::slice::from_ref(&first));
    let mut candidate = project(&root, std::slice::from_ref(&first));
    original
        .register_reachable_dependencies_from(&frontier)
        .unwrap();
    let consumed = reconcile(&mut candidate, &frontier);
    assert_eq!(consumed.value, [first]);
    assert!(!consumed.qualified);
    assert_eq!(packet(&candidate), packet(&original));
}

#[test]
fn actual_inferred_read_failure_keeps_stub_policy_and_refuses_qualification() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let first = write(&root, "First.ts", "import './Unreadable';\nexport {};\n");
    let unreadable = write(&root, "Unreadable.ts", [0xff, 0xfe]);
    let frontier = [first.clone()];
    let mut original = project(&root, &frontier);
    let mut candidate = project(&root, &frontier);
    original
        .register_reachable_dependencies_from(&frontier)
        .unwrap();
    let consumed = reconcile(&mut candidate, &frontier);
    assert_eq!(consumed.value, [first]);
    assert!(!consumed.qualified);
    assert!(candidate.find_by_original(&unreadable).is_none());
    assert_eq!(packet(&candidate), packet(&original));
}

#[test]
fn release_then_acquire_reconciles_the_real_owner_after_a_visited_target_was_pruned() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let first = write(&root, "First.ts", "export const first = 1;\n");
    let second = write(&root, "Second.ts", "import './Target';\nexport {};\n");
    let target = write(&root, "Target.ts", "export const target = 3;\n");
    let frontier = [first.clone(), second.clone()];
    let mut original = project(&root, &frontier);
    let mut candidate = project(&root, &frontier);
    original.register_reachable_dependencies().unwrap();
    candidate.register_reachable_dependencies().unwrap();
    assert!(candidate.find_by_original(&target).is_some());
    write(&root, "First.ts", "import './Target';\nexport {};\n");
    write(&root, "Second.ts", "export const second = 2;\n");
    for project in [&mut original, &mut candidate] {
        for path in &frontier {
            project.register_path(path).unwrap();
        }
    }
    original
        .register_reachable_dependencies_from(&frontier)
        .unwrap();
    let consumed = reconcile(&mut candidate, &frontier);
    assert_eq!(
        consumed.value,
        [second.clone(), first.clone(), target.clone()]
    );
    assert!(consumed.qualified);
    assert_eq!(
        candidate.dependency_edges.get(&first).unwrap(),
        &FxHashSet::from_iter([target.clone()])
    );
    assert!(candidate.dependency_edges.get(&second).unwrap().is_empty());
    assert_eq!(candidate.dependency_inbound.get(&target), Some(&1));
    assert!(candidate.find_by_original(&target).is_some());
    assert_eq!(packet(&candidate), packet(&original));
}

#[test]
fn both_actual_initial_registered_lists_own_keys_without_completing_unwalked_sources() {
    for scoped in [false, true] {
        let storage = tempfile::tempdir().unwrap();
        let root = storage.path().canonicalize().unwrap();
        let first = write(&root, "First.ts", "export {};\n");
        let untouched = write(&root, "Untouched.ts", "export {};\n");
        let mut candidate = project(&root, &[first.clone(), untouched.clone()]);
        let frontier = [first];
        let consumed = candidate
            .register_reachable_dependencies_consumed_inner(
                scoped.then_some(frontier.as_slice()),
                &Default::default(),
                &[],
                None,
                DependencyConsumption {
                    aliases: Some(Consumed {
                        value: Vec::new(),
                        stamps: Vec::new(),
                        qualified: true,
                    }),
                    resolver: None,
                    registered_roots: None,
                },
            )
            .unwrap();
        // The original key operation records CanonicalFile, not the separate
        // CanonicalPath-only authority borrowed by configured-project consumers.
        let expected_key =
            InputStamp::observed_canonical_file(untouched.clone(), untouched.clone(), true)
                .with_owner(Shared::new(FactOwner {
                    path: untouched.clone(),
                    role: FactRole::AuthoredSource,
                }));
        assert!(expected_key.consumed_canonical_selection().is_none());
        let keys = consumed
            .stamps
            .iter()
            .filter(|stamp| *stamp == &expected_key)
            .collect::<Vec<_>>();
        assert!(!keys.is_empty());
        for stamp in &keys {
            assert_eq!(stamp.owner().unwrap().role, FactRole::AuthoredSource);
            assert_eq!(stamp.owner().unwrap().path, untouched);
        }
        if scoped {
            assert!(!consumed.value.contains(&untouched));
        }
        std::fs::remove_file(&untouched).unwrap();
        for stamp in keys {
            let now = stamp.current_consumed_fact().unwrap();
            assert_eq!(
                stamp.source_revision_fact(&now, std::slice::from_ref(&untouched)),
                SourceRevisionFact::DeletedProbe
            );
        }
    }
}

#[test]
fn registered_key_restores_namespace_and_unverified_keys_grant_no_body_or_completion() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let registered = write(&root, "Registered.ts", "export {};\n");
    let unverified = write(&root, "Unverified.ts", "export {};\n");
    let candidate = project(&root, std::slice::from_ref(&registered));
    let (_, mut facts) = WalkFacts::from_aliases(
        Consumed {
            value: Vec::new(),
            stamps: Vec::new(),
            qualified: true,
        },
        &root,
    );
    assert_eq!(
        facts.registered_key(
            &registered,
            candidate.find_by_original(&registered).is_some()
        ),
        Some(registered.clone())
    );
    assert_eq!(
        facts.registered_key(
            &unverified,
            candidate.find_by_original(&unverified).is_some()
        ),
        Some(unverified.clone())
    );
    let consumed = facts.finish();
    assert!(!consumed.qualified);
    assert!(consumed.value.is_empty());
    assert!(
        consumed
            .stamps
            .iter()
            .all(|stamp| !stamp.is_authored_body_fact())
    );
    assert_eq!(consumed.stamps.len(), 2);
    assert_eq!(
        consumed.stamps[0].owner().unwrap().role,
        FactRole::AuthoredSource
    );
    assert_eq!(
        consumed.stamps[1].owner().unwrap().role,
        FactRole::Configuration
    );
    assert_eq!(consumed.stamps[1].owner().unwrap().path, root);
    std::fs::remove_file(&unverified).unwrap();
    let now = consumed.stamps[1].current_consumed_fact().unwrap();
    assert_eq!(
        consumed.stamps[1].source_revision_fact(&now, &[unverified]),
        SourceRevisionFact::Incompatible
    );
}

#[cfg(unix)]
#[test]
fn registered_source_retarget_and_global_config_negative_creation_keep_strict_refusal() {
    use crate::package_route::stamp::InputStamp;
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let source = write(&root, "Registered.ts", "export const value = 1;\n");
    let other = write(&root, "Other.ts", "export const value = 1;\n");
    let missing_config = root.join("higher-priority-config.json");
    let candidate = project(&root, std::slice::from_ref(&source));
    let config_probe =
        InputStamp::observed_is_file(missing_config.clone(), missing_config.is_file());
    let (_, mut facts) = WalkFacts::from_aliases(
        Consumed {
            value: Vec::new(),
            stamps: vec![config_probe],
            qualified: true,
        },
        &root,
    );
    assert_eq!(
        facts.registered_key(&source, candidate.find_by_original(&source).is_some()),
        Some(source.clone())
    );
    let consumed = facts.finish();
    assert_eq!(
        consumed.stamps[0].owner().unwrap().role,
        FactRole::Configuration
    );
    assert_eq!(
        consumed.stamps[1].owner().unwrap().role,
        FactRole::AuthoredSource
    );
    std::fs::remove_file(&source).unwrap();
    std::os::unix::fs::symlink(&other, &source).unwrap();
    std::fs::write(&missing_config, "{}").unwrap();
    for stamp in &consumed.stamps {
        let now = stamp.current_consumed_fact().unwrap();
        assert_eq!(
            stamp.source_revision_fact(&now, std::slice::from_ref(&source)),
            SourceRevisionFact::Incompatible
        );
    }
}
