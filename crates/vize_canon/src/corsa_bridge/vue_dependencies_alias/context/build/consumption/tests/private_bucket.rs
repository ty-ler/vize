//! A private bucket hash never grants identity, membership or cutoff authority.

use super::super::{FactOwner, FactRole, InputStamp, NativeFacts};
use crate::PackageRoute;
use crate::package_route::stamp::{PackageContributionRef, Shared};
use std::{
    hash::{BuildHasher, Hash, Hasher},
    path::{Path, PathBuf},
};
use vize_carton::FxHashSet;

impl NativeFacts {
    // Literal original operation; only the test method name changes.
    fn original_insert(&mut self, stamp: InputStamp) {
        if !self.observe {
            return;
        }
        let mut hasher = std::hash::DefaultHasher::new();
        stamp.hash(&mut hasher);
        let bucket = self.by_hash.entry(hasher.finish()).or_default();
        if bucket.iter().any(|index| {
            self.stamps
                .get(*index)
                .is_some_and(|existing| *existing == stamp)
        }) {
            return;
        }
        bucket.push(self.stamps.len());
        self.stamps.push(stamp);
    }

    fn original_contains_before(&self, expected: &InputStamp, cutoff: usize) -> bool {
        let mut hasher = std::hash::DefaultHasher::new();
        expected.hash(&mut hasher);
        self.by_hash.get(&hasher.finish()).is_some_and(|bucket| {
            bucket.iter().any(|index| {
                *index < cutoff
                    && self
                        .stamps
                        .get(*index)
                        .is_some_and(|current| current == expected)
            })
        })
    }

    // Literal original retirement, calling the original insertion control.
    fn original_remove_retired_owners(&mut self, current: &FxHashSet<PathBuf>) {
        let previous = std::mem::take(&mut self.stamps);
        self.by_hash.clear();
        for stamp in previous {
            let retired = stamp.owner().is_some_and(|owner| {
                owner.role != FactRole::Configuration && !current.contains(&owner.path)
            });
            if !retired {
                self.original_insert(stamp);
            }
        }
    }
}

fn owner(path: &str, role: FactRole) -> Shared<FactOwner> {
    Shared::new(FactOwner {
        path: PathBuf::from(path),
        role,
    })
}

fn route(nested_name: &str) -> PackageRoute {
    let nested = PackageRoute {
        package_root: PathBuf::from("/project/pkg/child"),
        package_link_root: PathBuf::from("/project/linked/child"),
        manifest_path: PathBuf::from("/project/pkg/child/package.json"),
        package_name: Some("child".into()),
        workspace_source: true,
        source_paths: vec![Path::new("/project/pkg/child").join(nested_name)],
        dependency_paths: vec![PathBuf::from("/project/pkg/child/types.d.ts")],
        source_targets: Vec::new(),
        nested_routes: Vec::new(),
    };
    PackageRoute {
        package_root: PathBuf::from("/project/pkg"),
        package_link_root: PathBuf::from("/project/linked"),
        manifest_path: PathBuf::from("/project/pkg/package.json"),
        package_name: Some("pkg".into()),
        workspace_source: true,
        source_paths: vec![PathBuf::from("/project/pkg/entry.vue")],
        dependency_paths: vec![PathBuf::from("/project/pkg/types.d.ts")],
        source_targets: Vec::new(),
        nested_routes: vec![nested],
    }
}

fn write(nested_name: &str, owner: Shared<FactOwner>) -> InputStamp {
    InputStamp::observed_editor_route_write(
        PathBuf::from("/project"),
        "#entry".into(),
        Shared::new(route(nested_name)),
    )
    .with_owner(owner)
}

fn body(bytes: &[u8], owner: Shared<FactOwner>) -> InputStamp {
    InputStamp::observed_source(PathBuf::from("/project/shared.vue"), bytes).with_owner(owner)
}

fn fixture() -> Vec<InputStamp> {
    let keep = owner("/project/Keep.ts", FactRole::LocalImporter);
    let first = write("first.vue", Shared::clone(&keep));
    let equal = write(
        "first.vue",
        owner("/project/Keep.ts", FactRole::LocalImporter),
    );
    let different = write("second.vue", Shared::clone(&keep));
    assert_eq!(first, equal);
    assert_ne!(first, different);
    assert!(!std::ptr::eq(
        first.owner().unwrap(),
        equal.owner().unwrap()
    ));
    let mut stamps = vec![
        first.clone(),
        first,
        equal,
        different.clone(),
        different,
        body(b"A", Shared::clone(&keep)),
        body(b"B", Shared::clone(&keep)),
        body(b"A", owner("/project/Retired.ts", FactRole::LocalImporter)),
        body(b"A", owner("/project/Retired.ts", FactRole::Configuration)),
    ];
    for role in [
        FactRole::AuthoredSource,
        FactRole::DependencyImporter,
        FactRole::EditorImporter,
    ] {
        stamps.push(body(b"A", owner("/project/Keep.ts", role)));
    }
    stamps.push(InputStamp::observed_source(
        PathBuf::from("/project/unowned.vue"),
        b"unowned",
    ));
    stamps.extend([stamps[0].clone(), stamps[5].clone(), stamps[8].clone()]);
    stamps
}

fn queries(stamps: &[InputStamp]) -> Vec<InputStamp> {
    let mut queries = stamps.to_vec();
    queries.extend([
        write(
            "absent.vue",
            owner("/project/Keep.ts", FactRole::LocalImporter),
        ),
        body(b"C", owner("/project/Keep.ts", FactRole::LocalImporter)),
        body(b"A", owner("/project/Unknown.ts", FactRole::LocalImporter)),
        body(b"A", owner("/project/Keep.ts", FactRole::Configuration)),
    ]);
    queries
}

fn pair(observe: bool, qualified: bool) -> (NativeFacts, NativeFacts) {
    let mut before = NativeFacts::new(observe);
    let mut after = NativeFacts::new(observe);
    if !qualified {
        before.incomplete();
        after.incomplete();
    }
    (before, after)
}

fn assert_packet(before: &NativeFacts, after: &NativeFacts, queries: &[InputStamp]) {
    assert_eq!(before.observe, after.observe);
    assert_eq!(before.qualified, after.qualified);
    assert_eq!(before.stamps, after.stamps);
    for (left, right) in before.stamps.iter().zip(&after.stamps) {
        if let Some((left, right)) = left.owner().zip(right.owner()) {
            assert!(std::ptr::eq(left, right));
        }
        if let (
            Some(PackageContributionRef::Route { route: left, .. }),
            Some(PackageContributionRef::Route { route: right, .. }),
        ) = (left.package_contribution(), right.package_contribution())
        {
            assert!(std::ptr::eq(left, right));
        }
    }
    // Hash values may change; every bucket index still names one complete fact.
    for facts in [before, after] {
        let mut indices = facts
            .by_hash
            .values()
            .flatten()
            .copied()
            .collect::<Vec<_>>();
        indices.sort_unstable();
        assert_eq!(indices, (0..facts.stamps.len()).collect::<Vec<_>>());
    }
    for cutoff in 0..=before.stamps.len() + 1 {
        for query in queries {
            assert_eq!(
                before.original_contains_before(query, cutoff),
                after.contains_before(query, cutoff),
                "cutoff {cutoff}: {query:?}"
            );
        }
    }
}

#[test]
fn private_hash_keeps_literal_original_collisions_order_cutoffs_and_owner_pointers() {
    let stamps = fixture();
    let queries = queries(&stamps);
    let old_hash = |stamp: &InputStamp| {
        let mut hasher = std::hash::DefaultHasher::new();
        stamp.hash(&mut hasher);
        hasher.finish()
    };
    assert_eq!(old_hash(&stamps[0]), old_hash(&stamps[3]));
    let builder = NativeFacts::new(true);
    assert_eq!(
        builder.by_hash.hasher().hash_one(&stamps[0]),
        builder.by_hash.hasher().hash_one(&stamps[3])
    );
    for observe in [false, true] {
        for qualified in [false, true] {
            let (mut before, mut after) = pair(observe, qualified);
            for stamp in &stamps {
                before.original_insert(stamp.clone());
                after.insert(stamp.clone());
                assert_packet(&before, &after, &queries);
            }
            assert_eq!(after.qualified, observe && qualified);
            if observe {
                assert!(std::ptr::eq(
                    after.stamps[0].owner().unwrap(),
                    stamps[0].owner().unwrap()
                ));
                assert_eq!(
                    after
                        .stamps
                        .iter()
                        .filter(|stamp| stamp.package_contribution().is_some())
                        .count(),
                    2
                );
            }
            let before = before.finish(());
            let after = after.finish(());
            assert_eq!(before.stamps, after.stamps);
            assert_eq!(before.qualified, after.qualified);
        }
    }
}

#[test]
fn private_hash_keeps_literal_original_retirement_configuration_and_rebuilt_indices() {
    let stamps = fixture();
    let queries = queries(&stamps);
    for observe in [false, true] {
        for qualified in [false, true] {
            let (mut before, mut after) = pair(observe, qualified);
            for stamp in &stamps {
                before.original_insert(stamp.clone());
                after.insert(stamp.clone());
            }
            for paths in [
                vec!["/project/Keep.ts", "/project/Retired.ts"],
                vec!["/project/Keep.ts"],
                Vec::new(),
                vec!["/project/Retired.ts"],
            ] {
                let current = paths.into_iter().map(PathBuf::from).collect();
                before.original_remove_retired_owners(&current);
                after.remove_retired_owners(&current);
                assert_packet(&before, &after, &queries);
                if observe {
                    assert!(after.stamps.contains(&stamps[8]));
                    assert!(after.stamps.contains(&stamps[12]));
                    assert!(
                        after
                            .stamps
                            .iter()
                            .all(|stamp| stamp.owner().is_none_or(|owner| {
                                owner.role == FactRole::Configuration
                                    || current.contains(&owner.path)
                            }))
                    );
                }
                // Reinsert actual current facts after clearing/rebuilding indices.
                for stamp in &stamps {
                    before.original_insert(stamp.clone());
                    after.insert(stamp.clone());
                }
                assert_packet(&before, &after, &queries);
            }
        }
    }
}
