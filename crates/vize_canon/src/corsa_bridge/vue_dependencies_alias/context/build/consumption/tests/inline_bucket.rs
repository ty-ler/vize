//! Inline storage preserves the complete fact oracle, collision order and witness.

use super::super::{FactBucket, FactOwner, FactRole, InputStamp, NativeFacts};
use crate::{PackageRoute, package_route::stamp::Shared};
use std::{
    hash::BuildHasher,
    panic::{AssertUnwindSafe, catch_unwind},
    path::Path,
};

fn owner(path: &str, role: FactRole) -> Shared<FactOwner> {
    Shared::new(FactOwner {
        path: path.into(),
        role,
    })
}

fn write(name: &str, owner: Shared<FactOwner>) -> InputStamp {
    let mut route = PackageRoute {
        package_root: "/project/pkg".into(),
        package_link_root: "/project/link/pkg".into(),
        manifest_path: "/project/pkg/package.json".into(),
        package_name: Some("pkg".into()),
        workspace_source: true,
        source_paths: vec!["/project/pkg/entry.vue".into()],
        dependency_paths: vec!["/project/pkg/types.d.ts".into()],
        source_targets: Vec::new(),
        nested_routes: Vec::new(),
    };
    let mut nested = route.clone();
    nested.source_paths = vec![Path::new("/project/pkg/child").join(name)];
    route.nested_routes.push(nested);
    InputStamp::observed_editor_route_write(
        "/project/pkg".into(),
        "#entry".into(),
        Shared::new(route),
    )
    .with_owner(owner)
}

fn collisions() -> Vec<InputStamp> {
    let owner = owner("/project/host.ts", FactRole::LocalImporter);
    ["first.vue", "second.vue", "third.vue", "absent.vue"]
        .map(|name| write(name, Shared::clone(&owner)))
        .into()
}

fn check(facts: &NativeFacts, expected: &[InputStamp], queries: &[InputStamp]) {
    assert_eq!(facts.stamps, expected);
    for (actual, expected) in facts.stamps.iter().zip(expected) {
        if let Some((actual, expected)) = actual.owner().zip(expected.owner()) {
            assert!(std::ptr::eq(actual, expected));
        }
        assert!(
            matches!(
                (actual.package_contribution(), expected.package_contribution()),
                (Some(crate::package_route::stamp::PackageContributionRef::Route { route: a, .. }),
                 Some(crate::package_route::stamp::PackageContributionRef::Route { route: b, .. }))
                 if std::ptr::eq(a, b)
            ) || actual.package_contribution().is_none()
        );
    }
    let mut indices = facts
        .by_hash
        .values()
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    indices.sort_unstable();
    assert_eq!(indices, (0..expected.len()).collect::<Vec<_>>());
    // Independent linear complete-equality oracle; it has no bucket storage/hash.
    for query in queries {
        for cutoff in 0..=expected.len() + 1 {
            assert_eq!(
                facts.contains_before(query, cutoff),
                expected.iter().take(cutoff).any(|stamp| stamp == query)
            );
        }
    }
}

#[test]
fn singleton_promotes_only_for_distinct_complete_collisions_and_keeps_first_identity() {
    let stamps = collisions();
    let mut facts = NativeFacts::new(true);
    let hash = facts.by_hash.hasher().hash_one(&stamps[0]);
    for stamp in &stamps {
        assert_eq!(facts.by_hash.hasher().hash_one(stamp), hash);
    }
    for (index, stamp) in stamps[..3].iter().enumerate() {
        assert!(stamps[..index].iter().all(|previous| previous != stamp));
        facts.insert(stamp.clone());
        check(&facts, &stamps[..=index], &stamps);
        if index == 0 {
            assert_eq!(facts.by_hash[&hash], FactBucket::Singleton(0));
            // Equal complete route/owner values in independent allocations coalesce.
            let equal = write(
                "first.vue",
                owner("/project/host.ts", FactRole::LocalImporter),
            );
            assert_eq!(*stamp, equal);
            assert!(!std::ptr::eq(
                stamp.owner().unwrap(),
                equal.owner().unwrap()
            ));
            facts.insert(equal);
            assert_eq!(facts.by_hash[&hash], FactBucket::Singleton(0));
        } else {
            assert!(
                matches!(&facts.by_hash[&hash], FactBucket::Collisions(indices)
                if indices == &(0..=index).collect::<Vec<_>>())
            );
        }
        facts.insert(stamp.clone());
        check(&facts, &stamps[..=index], &stamps);
    }
    assert_eq!(facts.stamps.len(), 3);
    assert!(facts.is_qualified());
    let mut disabled = NativeFacts::new(false);
    for stamp in stamps {
        disabled.insert(stamp);
    }
    assert!(disabled.stamps.is_empty() && disabled.by_hash.is_empty());
    assert!(!disabled.is_qualified());
}

#[test]
fn retirement_rebuilds_singletons_without_losing_configuration_or_unowned_negative_facts() {
    let stamps = collisions();
    let negative = InputStamp::observed_exists("/project/missing.ts".into(), false);
    let configuration = negative
        .clone()
        .with_owner(owner("/project/retired", FactRole::Configuration));
    let retired = negative
        .clone()
        .with_owner(owner("/project/host.ts", FactRole::DependencyImporter));
    let mut facts = NativeFacts::new(true);
    for stamp in stamps[..3]
        .iter()
        .chain([&configuration, &negative, &retired])
    {
        facts.insert(stamp.clone());
    }
    assert!(
        facts
            .by_hash
            .values()
            .any(|bucket| matches!(bucket, FactBucket::Collisions(_)))
    );
    facts.remove_retired_owners(&Default::default());
    let mut expected = vec![configuration.clone(), negative.clone()];
    check(
        &facts,
        &expected,
        &[retired.clone(), negative.clone(), configuration],
    );
    assert!(
        facts
            .by_hash
            .values()
            .all(|bucket| matches!(bucket, FactBucket::Singleton(_)))
    );
    facts.insert(stamps[1].clone());
    expected.push(stamps[1].clone());
    check(&facts, &expected, &stamps);
    assert!(
        facts
            .by_hash
            .values()
            .all(|bucket| matches!(bucket, FactBucket::Singleton(_)))
    );
    facts.insert(stamps[0].clone());
    expected.push(stamps[0].clone());
    check(&facts, &expected, &stamps);
    let hash = facts.by_hash.hasher().hash_one(&stamps[0]);
    assert_eq!(facts.by_hash[&hash].as_ref(), &[2, 3]);
    assert!(facts.is_qualified());
}

#[test]
fn collided_witness_keeps_vector_and_bucket_allocations_through_success_error_and_unwind() {
    let stamps = collisions();
    for qualified in [false, true] {
        let mut facts = NativeFacts::new(true);
        if !qualified {
            facts.incomplete();
        }
        for stamp in &stamps[..3] {
            facts.insert(stamp.clone());
        }
        let vector = facts.stamps.as_ptr();
        let hash = facts.by_hash.hasher().hash_one(&stamps[0]);
        let collision = facts.by_hash[&hash].as_ptr();
        let operation = |packet: &super::super::Consumed<()>| {
            assert_eq!(packet.stamps.as_ptr(), vector);
            assert_eq!(packet.stamps, stamps[..3]);
            assert_eq!(packet.qualified, qualified);
            for (a, b) in packet.stamps.iter().zip(&stamps) {
                assert!(std::ptr::eq(a.owner().unwrap(), b.owner().unwrap()));
            }
        };
        assert_eq!(
            facts.with_witness(|packet| {
                operation(packet);
                17
            }),
            17
        );
        let failure: Result<(), u8> = facts.with_witness(|packet| {
            operation(packet);
            Err(23)
        });
        assert_eq!(failure, Err(23));
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                facts.with_witness(|packet| {
                    operation(packet);
                    panic!("whole original collision owner failed")
                });
            }))
            .is_err()
        );
        assert_eq!(facts.stamps.as_ptr(), vector);
        assert_eq!(facts.by_hash[&hash].as_ptr(), collision);
        check(&facts, &stamps[..3], &stamps);
        for stamp in &stamps[..3] {
            facts.insert(stamp.clone());
        }
        assert_eq!(facts.stamps.as_ptr(), vector);
        assert_eq!(facts.by_hash[&hash].as_ptr(), collision);
        assert_eq!(facts.is_qualified(), qualified);
        let completed = facts.finish(31);
        assert_eq!(completed.value, 31);
        assert_eq!(completed.stamps.as_ptr(), vector);
        assert_eq!(completed.stamps, stamps[..3]);
        assert_eq!(completed.qualified, qualified);
    }
}
