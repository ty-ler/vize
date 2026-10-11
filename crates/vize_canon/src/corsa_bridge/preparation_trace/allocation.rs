//! Global counter windows overlap; they are not exclusive callsite attribution.

use std::sync::OnceLock;
use vize_l0::profiler::{AllocationSnapshot, allocation_snapshot};

static ENABLED: OnceLock<bool> = OnceLock::new();

pub(super) struct Window(AllocationSnapshot);

impl Window {
    pub(super) fn begin() -> Option<Self> {
        let enabled = *ENABLED
            .get_or_init(|| std::env::var("VIZE_LSP_ALLOCATION_DIAGNOSTIC").as_deref() == Ok("1"));
        enabled.then(|| Self(allocation_snapshot()))
    }

    pub(super) fn finish(self, phase: &'static str, id: u64, completed: bool) {
        let before = self.0;
        let after = allocation_snapshot();
        tracing::info!(target: "vize_editor_allocation", event = "window",
            pid = std::process::id(), phase, id, completed,
            phase_size = std::mem::size_of::<super::Phase>(),
            allocation_window_size = std::mem::size_of::<Self>(),
            allocation_field_size = std::mem::size_of::<Option<Self>>(),
            scope = "global_overlapping_window_with_observer_overhead",
            diagnostic_only = true, acceptance_credit = "none",
            before_alloc_calls = before.alloc_calls, after_alloc_calls = after.alloc_calls,
            before_alloc_zeroed_calls = before.alloc_zeroed_calls,
            after_alloc_zeroed_calls = after.alloc_zeroed_calls,
            before_alloc_failures = before.alloc_failures,
            after_alloc_failures = after.alloc_failures,
            before_alloc_zeroed_failures = before.alloc_zeroed_failures,
            after_alloc_zeroed_failures = after.alloc_zeroed_failures,
            before_alloc_bytes = before.alloc_bytes, after_alloc_bytes = after.alloc_bytes,
            before_alloc_zeroed_bytes = before.alloc_zeroed_bytes,
            after_alloc_zeroed_bytes = after.alloc_zeroed_bytes,
            before_dealloc_calls = before.dealloc_calls, after_dealloc_calls = after.dealloc_calls,
            before_dealloc_bytes = before.dealloc_bytes, after_dealloc_bytes = after.dealloc_bytes,
            before_realloc_calls = before.realloc_calls, after_realloc_calls = after.realloc_calls,
            before_realloc_failures = before.realloc_failures,
            after_realloc_failures = after.realloc_failures,
            before_realloc_old_bytes = before.realloc_old_bytes,
            after_realloc_old_bytes = after.realloc_old_bytes,
            before_realloc_new_bytes = before.realloc_new_bytes,
            after_realloc_new_bytes = after.realloc_new_bytes);
    }
}
