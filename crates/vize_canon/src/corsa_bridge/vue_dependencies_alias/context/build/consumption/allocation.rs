//! Immutable dimensions of actual containers, not allocator classes or RSS.

use super::{FactBucket, InputStamp, NativeFacts};
use std::{mem::size_of, sync::OnceLock};

static ENABLED: OnceLock<bool> = OnceLock::new();

#[derive(Debug, Eq, PartialEq)]
struct Dimensions {
    facts_len: usize,
    facts_capacity: usize,
    map_len: usize,
    map_capacity: usize,
    empty: usize,
    singleton: usize,
    collision: usize,
    collision_len: usize,
    collision_capacity: usize,
}

fn capture(enabled: bool, facts: &NativeFacts) -> Option<Dimensions> {
    enabled.then(|| {
        let mut dimensions = Dimensions {
            facts_len: facts.stamps.len(),
            facts_capacity: facts.stamps.capacity(),
            map_len: facts.by_hash.len(),
            map_capacity: facts.by_hash.capacity(),
            empty: 0,
            singleton: 0,
            collision: 0,
            collision_len: 0,
            collision_capacity: 0,
        };
        for bucket in facts.by_hash.values() {
            match bucket {
                FactBucket::Empty => dimensions.empty += 1,
                FactBucket::Singleton(_) => dimensions.singleton += 1,
                FactBucket::Collisions(indices) => {
                    dimensions.collision += 1;
                    dimensions.collision_len += indices.len();
                    dimensions.collision_capacity += indices.capacity();
                }
            }
        }
        dimensions
    })
}

#[expect(
    clippy::vec_init_then_push,
    reason = "Observe the original Vec first-push capacity"
)]
pub(super) fn record(facts: &NativeFacts) {
    let enabled = *ENABLED
        .get_or_init(|| std::env::var("VIZE_LSP_ALLOCATION_DIAGNOSTIC").as_deref() == Ok("1"));
    let Some(report) = capture(enabled, facts) else {
        return;
    };
    // This separate owned probe measures only Vec's first requested capacity.
    // It contributes observer overhead to the global allocation window.
    let mut old_singleton = Vec::<usize>::new();
    old_singleton.push(0);
    tracing::info!(target: "vize_editor_allocation", event = "native_fact_storage",
        pid = std::process::id(), diagnostic_only = true, acceptance_credit = "none",
        observe = facts.observe, qualified = facts.qualified,
        facts_len = report.facts_len, facts_capacity = report.facts_capacity,
        stamp_size = size_of::<InputStamp>(), map_len = report.map_len,
        map_usable_capacity = report.map_capacity, bucket_size = size_of::<FactBucket>(),
        old_vec_bucket_size = size_of::<Vec<usize>>(),
        map_pair_size = size_of::<(u64, FactBucket)>(),
        old_map_pair_size = size_of::<(u64, Vec<usize>)>(),
        empty_buckets = report.empty, singleton_buckets = report.singleton,
        collision_buckets = report.collision, collision_indices = report.collision_len,
        collision_capacity = report.collision_capacity, index_size = size_of::<usize>(),
        old_singleton_probe_capacity = old_singleton.capacity(),
        map_allocation = "usable_capacity_is_not_raw_bucket_count_or_allocated_bytes",
        allocator_class = "unobserved", arc_and_path_allocations = "not_walked",
        observer_overhead = "immutable_bucket_scan_and_one_owned_vec_probe");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package_route::stamp::{FactOwner, FactRole, Shared};

    #[test]
    fn dimensions_count_actual_collision_capacity_without_changing_any_allocation() {
        let mut facts = NativeFacts::new(true);
        facts.stamps.reserve(17);
        facts.by_hash.reserve(9);
        facts.by_hash.insert(1, FactBucket::Empty);
        facts.by_hash.insert(2, FactBucket::Singleton(0));
        let mut collision = Vec::with_capacity(11);
        collision.extend([1, 2, 3]);
        let collision_pointer = collision.as_ptr();
        let collision_capacity = collision.capacity();
        facts.by_hash.insert(3, FactBucket::Collisions(collision));
        let vector = facts.stamps.as_ptr();
        let before = facts.by_hash.clone();
        let report = capture(true, &facts).unwrap();
        assert_eq!(report.facts_capacity, facts.stamps.capacity());
        assert_eq!(report.map_capacity, facts.by_hash.capacity());
        assert_eq!(
            (report.empty, report.singleton, report.collision),
            (1, 1, 1)
        );
        assert_eq!(report.collision_len, 3);
        assert_eq!(report.collision_capacity, collision_capacity);
        assert_eq!(facts.by_hash, before);
        assert_eq!(facts.stamps.as_ptr(), vector);
        assert_eq!(facts.by_hash[&3].as_ptr(), collision_pointer);
    }

    #[test]
    fn disabled_and_enabled_capture_preserve_full_facts_owners_order_and_retirement() {
        let mut facts = NativeFacts::new(true);
        let mut expected = Vec::new();
        for (role, path) in [
            (FactRole::Configuration, "/project/config.json"),
            (FactRole::AuthoredSource, "/project/retired.vue"),
        ] {
            let stamp = InputStamp::observed_exists("/project/missing.ts".into(), false)
                .with_owner(Shared::new(FactOwner {
                    path: path.into(),
                    role,
                }));
            facts.insert(stamp.clone());
            expected.push(stamp);
        }
        let negative = InputStamp::observed_exists("/project/negative.ts".into(), false);
        facts.insert(negative.clone());
        expected.push(negative);
        facts.incomplete();
        let pointer = facts.stamps.as_ptr();
        let buckets = facts.by_hash.clone();
        assert_eq!(capture(false, &facts), None);
        assert_eq!(capture(true, &facts).unwrap().facts_len, 3);
        assert_eq!(facts.stamps, expected);
        assert_eq!(facts.stamps.as_ptr(), pointer);
        assert_eq!(facts.by_hash, buckets);
        assert!(!facts.qualified);
        for (actual, original) in facts.stamps.iter().zip(&expected) {
            if let Some((actual, original)) = actual.owner().zip(original.owner()) {
                assert!(std::ptr::eq(actual, original));
            }
        }
        facts.remove_retired_owners(&Default::default());
        assert_eq!(capture(true, &facts).unwrap().facts_len, 2);
        assert_eq!(facts.stamps, vec![expected[0].clone(), expected[2].clone()]);
        let completed = facts.finish(29);
        assert_eq!(completed.value, 29);
        assert!(!completed.qualified);
        assert_eq!(
            completed.stamps,
            vec![expected[0].clone(), expected[2].clone()]
        );
        assert_eq!(
            capture(true, &NativeFacts::new(false)).unwrap().facts_len,
            0
        );
    }
}
