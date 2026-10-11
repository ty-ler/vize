//! Native CLI binary for Vize.

#[cfg(not(feature = "profiling"))]
#[global_allocator]
static GLOBAL_ALLOCATOR: vize_l0::profiler::ProfilingAllocator<mimalloc::MiMalloc> =
    vize_l0::profiler::ProfilingAllocator::from_allocator(mimalloc::MiMalloc);

#[cfg(feature = "profiling")]
#[global_allocator]
static GLOBAL_ALLOCATOR: vize_l0::profiler::ProfilingAllocator<mimalloc::MiMalloc> =
    vize_l0::profiler::ProfilingAllocator::from_allocator(mimalloc::MiMalloc);

fn main() {
    if std::env::var_os("VIZE_LSP_ALLOCATION_TRACE_DIR").is_some() {
        vize_l0::profiler::set_allocation_tracking_enabled(true);
    }
    vize::cli::run_from_env();
}
