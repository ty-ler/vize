//! Optional bounded statistics of immutable retained facts, never identity authority.

use crate::package_route::stamp::InputStamp;
use std::hash::BuildHasher;
use std::path::{Component, Path};
use vize_carton::FxHashMap;

const MAX_KEYS: usize = 131_072;
const MAX_FACTS: usize = 500_000;

#[derive(Debug, Default, Eq, PartialEq)]
pub(super) struct PopulationReport {
    pub(super) full_facts: usize,
    pub(super) full_buckets: usize,
    pub(super) full_max: usize,
    pub(super) full_pairs: u128,
    pub(super) suffix_facts: usize,
    pub(super) suffix_buckets: usize,
    pub(super) suffix_max: usize,
    pub(super) suffix_pairs: u128,
    pub(super) suffix_over_eight_buckets: usize,
    pub(super) suffix_over_eight_facts: usize,
    pub(super) complete: bool,
}

pub(super) fn capture(
    stamps: &[InputStamp],
    full: &FxHashMap<u64, impl AsRef<[usize]>>,
) -> PopulationReport {
    capture_limited(stamps, full, MAX_KEYS, MAX_FACTS)
}

// Component normalization retains ParentDir, root/prefix tags and non-UTF-8 names.
// Reverse order is a bijection of the last three component tuple, with no strings.
fn suffix(path: &Path) -> [Option<Component<'_>>; 3] {
    let mut parts = path.components().rev();
    [parts.next(), parts.next(), parts.next()]
}

fn capture_limited(
    stamps: &[InputStamp],
    full: &FxHashMap<u64, impl AsRef<[usize]>>,
    max_keys: usize,
    max_facts: usize,
) -> PopulationReport {
    let mut report = PopulationReport {
        full_facts: stamps.len(),
        full_buckets: full.len(),
        ..PopulationReport::default()
    };
    for bucket in full.values() {
        let count = bucket.as_ref().len();
        report.full_max = report.full_max.max(count);
        report.full_pairs += (count as u128) * (count.saturating_sub(1) as u128) / 2;
    }
    let mut counts: FxHashMap<u64, usize> = FxHashMap::default();
    for stamp in stamps.iter().take(max_facts) {
        let owner = stamp.owner().map(|owner| (owner.role, suffix(&owner.path)));
        let key = full.hasher().hash_one((suffix(stamp.path()), owner));
        if !counts.contains_key(&key)
            && (counts.len() == max_keys || counts.try_reserve(1).is_err())
        {
            break;
        }
        let count = counts.entry(key).or_default();
        report.suffix_pairs += *count as u128;
        *count += 1;
        report.suffix_max = report.suffix_max.max(*count);
        report.suffix_facts += 1;
    }
    report.suffix_buckets = counts.len();
    for count in counts.values().copied().filter(|count| *count > 8) {
        report.suffix_over_eight_buckets += 1;
        report.suffix_over_eight_facts += count;
    }
    report.complete = report.suffix_facts == stamps.len();
    report
}

#[cfg(test)]
mod tests {
    use super::super::NativeFacts;
    use super::*;
    use crate::{
        PackageRoute,
        package_route::stamp::{FactOwner, FactRole, PackageContributionRef, Shared},
    };
    use FactRole::*;
    const SOURCE: &str = "/alpha/root/src/entry.ts";
    const OWNER: &str = "/alpha/owner/src/host.ts";
    fn owner(path: &str, role: FactRole) -> Shared<FactOwner> {
        Shared::new(FactOwner {
            path: path.into(),
            role,
        })
    }

    fn body(path: &str, value: u8, owner: Option<Shared<FactOwner>>) -> InputStamp {
        let stamp = InputStamp::observed_source(path.into(), &[value]);
        match owner {
            Some(owner) => stamp.with_owner(owner),
            None => stamp,
        }
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
        let mut child = route.clone();
        child.source_paths = vec![Path::new("/project/pkg/child").join(name)];
        route.nested_routes.push(child);
        InputStamp::observed_editor_route_write(
            "/project/pkg".into(),
            "#entry".into(),
            Shared::new(route),
        )
        .with_owner(owner)
    }

    fn fixture() -> Vec<InputStamp> {
        let role = LocalImporter;
        let first_owner = owner(OWNER, role);
        let first = body(SOURCE, 1, Some(Shared::clone(&first_owner)));
        let equal = body(SOURCE, 1, Some(owner(OWNER, role)));
        assert_eq!(first, equal);
        assert!(!std::ptr::eq(
            first.owner().unwrap(),
            equal.owner().unwrap()
        ));
        let mut stamps = vec![
            first,
            equal,
            body(
                "/b/root/src/entry.ts",
                2,
                Some(owner("/b/owner/src/host.ts", role)),
            ),
        ];
        for role in [
            Configuration,
            AuthoredSource,
            DependencyImporter,
            EditorImporter,
        ] {
            stamps.push(body(SOURCE, 1, Some(owner(OWNER, role))));
        }
        for path in [
            SOURCE,
            "/alpha/root/src/./entry.ts",
            "/alpha/root/src/../entry.ts",
            "entry.ts",
            "./entry.ts",
            "../entry.ts",
            "/entry.ts",
        ] {
            stamps.push(body(path, 3, None));
        }
        stamps.extend([
            write("first.vue", Shared::clone(&first_owner)),
            write("second.vue", Shared::clone(&first_owner)),
            write("first.vue", first_owner),
        ]);
        for value in 0..9 {
            stamps.push(body("/alpha/root/src/shared.ts", value, None));
        }
        stamps
    }

    fn index(stamps: &[InputStamp]) -> FxHashMap<u64, Vec<usize>> {
        let mut full: FxHashMap<u64, Vec<usize>> = FxHashMap::default();
        for (position, stamp) in stamps.iter().enumerate() {
            let hash = full.hasher().hash_one(stamp);
            full.entry(hash).or_insert_with(Vec::new).push(position);
        }
        full
    }

    fn oracle(stamps: &[InputStamp], full: &FxHashMap<u64, Vec<usize>>) -> PopulationReport {
        // Independently group exact normalized component tuples, not suffix hashes.
        fn components(path: &Path) -> Vec<Component<'_>> {
            let parts = path.components().collect::<Vec<_>>();
            parts[parts.len().saturating_sub(3)..].to_vec()
        }
        let mut groups = Vec::new();
        for stamp in stamps {
            let owner = stamp
                .owner()
                .map(|owner| (owner.role, components(&owner.path)));
            let key = (components(stamp.path()), owner);
            if let Some((_, count)) = groups.iter_mut().find(|(previous, _)| *previous == key) {
                *count += 1;
            } else {
                groups.push((key, 1_usize));
            }
        }
        let pairs = |n: usize| n as u128 * n.saturating_sub(1) as u128 / 2;
        PopulationReport {
            full_facts: stamps.len(),
            full_buckets: full.len(),
            full_max: full.values().map(Vec::len).max().unwrap_or(0),
            full_pairs: full.values().map(|bucket| pairs(bucket.len())).sum(),
            suffix_facts: stamps.len(),
            suffix_buckets: groups.len(),
            suffix_max: groups.iter().map(|(_, n)| *n).max().unwrap_or(0),
            suffix_pairs: groups.iter().map(|(_, n)| pairs(*n)).sum(),
            suffix_over_eight_buckets: groups.iter().filter(|(_, n)| *n > 8).count(),
            suffix_over_eight_facts: groups.iter().filter(|(_, n)| *n > 8).map(|(_, n)| *n).sum(),
            complete: true,
        }
    }

    fn route_pointer(stamp: &InputStamp) -> Option<*const PackageRoute> {
        match stamp.package_contribution() {
            Some(PackageContributionRef::Route { route, .. }) => Some(route as *const _),
            _ => None,
        }
    }

    fn unchanged(before: &[InputStamp], after: &[InputStamp]) {
        assert_eq!(before, after);
        for (left, right) in before.iter().zip(after) {
            if let Some((left, right)) = left.owner().zip(right.owner()) {
                assert!(std::ptr::eq(left, right));
            }
            assert_eq!(route_pointer(left), route_pointer(right));
        }
    }

    fn capture_unchanged(
        stamps: &[InputStamp],
        full: &FxHashMap<u64, impl AsRef<[usize]> + Clone + std::fmt::Debug + PartialEq>,
    ) -> PopulationReport {
        let (before, old_full) = (stamps.to_vec(), full.clone());
        let report = capture(stamps, full);
        unchanged(&before, stamps);
        assert_eq!(old_full, *full);
        report
    }

    #[test]
    fn exact_population_keeps_full_buckets_order_and_all_owner_route_pointers() {
        let stamps = fixture();
        let full = index(&stamps);
        let original_pointer = stamps.as_ptr();
        let is_route = |stamp: &InputStamp| stamp.package_contribution().is_some();
        let first_route = stamps.iter().position(is_route).unwrap();
        assert_ne!(stamps[first_route], stamps[first_route + 1]);
        assert_eq!(stamps[first_route], stamps[first_route + 2]);
        assert_ne!(
            route_pointer(&stamps[first_route]),
            route_pointer(&stamps[first_route + 2])
        );
        let hash = |stamp: &InputStamp| full.hasher().hash_one(stamp);
        assert_eq!(hash(&stamps[first_route]), hash(&stamps[first_route + 1]));
        assert_ne!(stamps[0], stamps[2]);
        let report = capture_unchanged(&stamps, &full);
        assert_eq!(report, oracle(&stamps, &full));
        assert_eq!(report.suffix_over_eight_buckets, 1);
        assert_eq!(report.suffix_over_eight_facts, 9);
        assert_eq!(original_pointer, stamps.as_ptr());
    }

    #[test]
    fn negative_facts_survive_capture_and_original_retirement_remains_the_owner() {
        let negative = InputStamp::observed_exists("/project/missing.ts".into(), false);
        let mut facts = NativeFacts::new(true);
        for (path, role) in [
            ("/project/config", Configuration),
            ("/project/old.vue", AuthoredSource),
            ("/project/old.ts", DependencyImporter),
        ] {
            facts.insert(negative.clone().with_owner(owner(path, role)));
        }
        facts.insert(negative.clone());
        facts.insert(negative.clone());
        let configuration = facts.stamps[0].clone();
        let expected = PopulationReport {
            full_facts: 4,
            full_buckets: 4,
            full_max: 1,
            full_pairs: 0,
            suffix_facts: 4,
            suffix_buckets: 4,
            suffix_max: 1,
            suffix_pairs: 0,
            suffix_over_eight_buckets: 0,
            suffix_over_eight_facts: 0,
            complete: true,
        };
        assert_eq!(capture_unchanged(&facts.stamps, &facts.by_hash), expected);
        facts.remove_retired_owners(&Default::default());
        unchanged(&[configuration, negative.clone()], &facts.stamps);
        assert_eq!(
            capture_unchanged(&facts.stamps, &facts.by_hash),
            PopulationReport {
                full_facts: 2,
                full_buckets: 2,
                suffix_facts: 2,
                suffix_buckets: 2,
                ..expected
            }
        );
        // Supplied ordered duplicates are counted and remain untouched.
        let duplicates = vec![negative.clone(), negative];
        let full = index(&duplicates);
        let report = capture_unchanged(&duplicates, &full);
        assert_eq!(report, oracle(&duplicates, &full));
        assert_eq!((report.full_pairs, report.suffix_pairs), (1, 1));
    }

    #[test]
    fn limits_refuse_explicitly_and_report_only_the_processed_prefix() {
        assert_eq!((MAX_KEYS, MAX_FACTS), (131_072, 500_000));
        let stamps = (0..4)
            .map(|n| body(&format!("/project/src/entry{n}.ts"), n, None))
            .collect::<Vec<_>>();
        let full = index(&stamps);
        let expected = oracle(&stamps, &full);
        assert_eq!(capture_limited(&stamps, &full, 4, 4), expected);
        for (keys, facts, prefix) in [(3, 4, 3), (4, 3, 3), (0, 4, 0), (4, 0, 0)] {
            let report = capture_limited(&stamps, &full, keys, facts);
            let expected = oracle(&stamps[..prefix], &full);
            assert_eq!(
                report,
                PopulationReport {
                    full_facts: stamps.len(),
                    complete: false,
                    ..expected
                }
            );
        }
        // An existing bucket still accepts facts at the unique-key boundary.
        let same = (0..4)
            .map(|n| body("/project/src/shared.ts", n, None))
            .collect::<Vec<_>>();
        let full = index(&same);
        assert_eq!(capture_limited(&same, &full, 1, 4), oracle(&same, &full));
        assert!(capture_limited(&[], &FxHashMap::<u64, Vec<usize>>::default(), 0, 0).complete);
    }
}
