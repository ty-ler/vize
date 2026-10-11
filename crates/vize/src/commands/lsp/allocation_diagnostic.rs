//! A separate diagnostic binary observes the existing MiMalloc wrapper only.

const FLAG: &str = "VIZE_LSP_ALLOCATION_DIAGNOSTIC";

pub(super) struct Capture;

pub(super) fn begin() -> Option<Capture> {
    if std::env::var(FLAG).as_deref() != Ok("1") {
        return None;
    }
    emit("begin");
    vize_l0::profiler::set_allocation_tracking_enabled(true);
    Some(Capture)
}

pub(super) fn finish(capture: Option<Capture>) {
    if capture.is_none() {
        return;
    }
    vize_l0::profiler::set_allocation_tracking_enabled(false);
    emit("end");
}

fn emit(event: &str) {
    let counters = vize_l0::profiler::allocation_snapshot();
    eprintln!(
        "vize_lsp_allocation_session event={event} pid={} allocator=existing_ProfilingAllocator_MiMalloc diagnostic_only=true acceptance_credit=none alloc_calls={} alloc_zeroed_calls={} alloc_failures={} alloc_zeroed_failures={} alloc_bytes={} alloc_zeroed_bytes={} dealloc_calls={} dealloc_bytes={} realloc_calls={} realloc_failures={} realloc_old_bytes={} realloc_new_bytes={}",
        std::process::id(),
        counters.alloc_calls,
        counters.alloc_zeroed_calls,
        counters.alloc_failures,
        counters.alloc_zeroed_failures,
        counters.alloc_bytes,
        counters.alloc_zeroed_bytes,
        counters.dealloc_calls,
        counters.dealloc_bytes,
        counters.realloc_calls,
        counters.realloc_failures,
        counters.realloc_old_bytes,
        counters.realloc_new_bytes,
    );
}
