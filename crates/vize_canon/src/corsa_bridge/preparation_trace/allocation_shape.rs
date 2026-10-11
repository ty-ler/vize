//! The ordinary Phase retains its complete original field shape.

use super::Phase;
use std::{mem::size_of, time::Instant};

#[allow(
    dead_code,
    reason = "Frozen original field shape for a compile-time layout law"
)]
struct OriginalPhaseShape {
    name: &'static str,
    id: u64,
    started: Option<Instant>,
    completed: bool,
    graph_revision: Option<(u8, u8, usize, usize)>,
}

#[cfg(not(feature = "allocation-diagnostic"))]
const _: [(); size_of::<Phase>()] = [(); size_of::<OriginalPhaseShape>()];

#[test]
fn original_and_diagnostic_phase_shapes_are_reported_separately() {
    let original = size_of::<OriginalPhaseShape>();
    let actual = size_of::<Phase>();
    #[cfg(not(feature = "allocation-diagnostic"))]
    assert_eq!(actual, original);
    #[cfg(feature = "allocation-diagnostic")]
    {
        let phase = Phase::start("allocation_shape_control", 0);
        assert!(actual >= original);
        // This field exists only in the diagnostic feature graph.
        assert_eq!(
            phase.allocation.is_some(),
            std::env::var("VIZE_LSP_ALLOCATION_DIAGNOSTIC").as_deref() == Ok("1")
        );
    }
    eprintln!(
        "vize_allocation_phase_shape allocation_diagnostic={} original_bytes={original} actual_bytes={actual} acceptance_credit=none",
        cfg!(feature = "allocation-diagnostic")
    );
}
