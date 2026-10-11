use super::FlattenedChain;
use crate::package_route::stamp::InputStamp;
use std::path::PathBuf;
use vize_carton::{FxHashMap, FxHashSet};

/// The state of one flattening operation.
#[derive(Default)]
pub(super) struct ChainLoad {
    /// The configs between the entry point and the one being flattened. Only
    /// these can close a cycle.
    pub(super) active: FxHashSet<PathBuf>,
    /// Chains already flattened during this operation. A config reachable
    /// through several `extends` paths is read, parsed and merged once instead
    /// of once per path, which keeps a diamond graph linear rather than
    /// exponential in its depth.
    pub(super) completed: FxHashMap<PathBuf, FlattenedChain>,
    /// Whether a cycle was cut while flattening the current chain. That result
    /// depends on which configs happened to be active, so it is not reusable
    /// from anywhere else in the graph and must not be cached.
    pub(super) cycle_cut: bool,
    pub(super) stamps: Vec<InputStamp>,
    pub(super) unknown: bool,
    pub(super) observe: bool,
}
