//! Genuine validator carriers from actual original operations; unexecuted.

use super::{fixture, run};
use crate::package_route::stamp::{FactRole, SourceRevisionFact};
use vize_carton::FxHashMap;

#[test]
fn actual_deleted_probe_carrier_and_independent_resolver_close_only_the_exact_canonical_fact() {
    use crate::batch::virtual_project::{
        VirtualProject, dependency_scan::resolve_dependency_observed,
    };
    use crate::corsa_bridge::vue_dependencies_alias::context::build::consumption::NativeFacts;
    use vize_carton::FxHashSet;
    let (_storage, host, target) = fixture();
    let body = "<script setup lang='ts'>import './target.ts';</script>";
    std::fs::write(&host, body).unwrap();
    std::fs::write(&target, "export const value = 1;").unwrap();
    let root = host.parent().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let mut mirror = VirtualProject::new(root).unwrap();
    let mut facts = NativeFacts::new(true);
    facts.record_owned(
        mirror
            .register_paths_observed(&[host.clone(), target.clone()])
            .unwrap(),
    );
    let aliases = mirror.dependency_alias_map_observed();
    facts.record_owned(
        mirror
            .register_reachable_dependencies_from_consumed(std::slice::from_ref(&host), aliases)
            .unwrap(),
    );
    let previous = facts.finish(());
    let known = mirror.registered_original_paths_sorted();
    std::fs::remove_file(&target).unwrap();
    // Genuine validate result from actual registration/walk packets, without
    // any manually qualified carrier or completed native builder assertion.
    let preflight = run(
        &previous.stamps,
        previous.qualified,
        &known,
        (&host, body.as_bytes()),
        &FxHashMap::default(),
        &[],
    )
    .unwrap();
    assert_eq!(preflight.value.deleted, vec![target.clone()]);
    assert_eq!(preflight.stamps.len(), previous.stamps.len());
    let actual_deleted_probes = previous
        .stamps
        .iter()
        .zip(&preflight.stamps)
        .filter(|(old, current)| {
            old.source_revision_fact(current, &preflight.value.deleted)
                == SourceRevisionFact::DeletedProbe
        })
        .map(|(_, current)| current.clone())
        .collect::<Vec<_>>();
    assert_eq!(preflight.value.deleted_probes, actual_deleted_probes);
    let deleted = FxHashSet::from_iter(preflight.value.deleted.iter().cloned());
    let carrier = preflight
        .value
        .deleted_probes
        .iter()
        .find(|stamp| {
            stamp
                .expected_deleted_canonical_resolver_probe(&deleted)
                .is_some()
        })
        .unwrap();
    assert!(preflight.stamps.contains(carrier));
    assert_eq!(carrier.owner().unwrap().path, host);
    let old = previous
        .stamps
        .iter()
        .find(|stamp| stamp.expected_deleted_probe_replacement(&deleted).as_ref() == Some(carrier))
        .unwrap();
    let mut rebuilt = NativeFacts::new(true);
    let resolver = resolve_dependency_observed("./target.ts", root, root, &[]);
    assert!(resolver.value.0.is_none());
    rebuilt.record(resolver, FactRole::LocalImporter, &host);
    rebuilt.retain_previous_with_validated_deleted(
        &previous.stamps,
        &[],
        &[],
        std::slice::from_ref(&target),
        &preflight.value.deleted,
        &preflight.value.deleted_probes,
    );
    let rebuilt = rebuilt.finish(());
    assert!(rebuilt.stamps.contains(carrier));
    assert!(!rebuilt.stamps.contains(old));
    mirror.remove_registered_source(&target);
    let known = mirror
        .registered_original_paths_sorted()
        .into_iter()
        .collect();
    assert!(super::super::reconciled_are_current(
        &rebuilt,
        &known,
        &host,
        body.as_bytes(),
        &FxHashMap::default(),
        &[]
    ));
    std::fs::write(&target, "export const value = 1;").unwrap();
    assert!(!super::super::reconciled_are_current(
        &rebuilt,
        &known,
        &host,
        body.as_bytes(),
        &FxHashMap::default(),
        &[]
    ));
}
