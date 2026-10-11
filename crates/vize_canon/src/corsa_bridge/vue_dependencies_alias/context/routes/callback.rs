//! Original callback result and same-entry reachability facts.

use crate::batch::virtual_project::PackageRouteReachability;
use crate::batch::virtual_project::package_resolution::PackageResolutionSettings;
use crate::package_route::stamp::Consumed;
use crate::package_route::stamp::record_package_input_members;
use std::path::{Path, PathBuf};

#[expect(
    clippy::large_enum_variant,
    reason = "original callback provenance stays inline without a per-occurrence allocation"
)]
pub(crate) enum PackageCallback {
    RuntimeSupport,
    Occurrence(PackageOccurrence),
}

pub(crate) struct PackageOccurrence {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) source_options: crate::PackageSourceOptions,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) context: crate::PackageResolutionContext,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) context_inputs: Vec<PathBuf>,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) raw_lookup: crate::PackageRouteLookup,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) reachability: PackageRouteReachability,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) failures: Vec<(PathBuf, &'static str, std::io::ErrorKind)>,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) reachability_origin: Option<ReachabilityOrigin>,
    pub(crate) needs_shadow: bool,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) track_reachability: bool,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) watchable_negative: bool,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) route_inputs: Vec<PathBuf>,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) binding: Option<crate::PackageRouteBinding>,
    // Emission into a pending Vec is not current registered graph-root authority.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "original callback facts retained for native provenance"
        )
    )]
    pub(crate) binding_registered: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReachabilityOrigin {
    pub(crate) source_options: crate::PackageSourceOptions,
    pub(crate) route: crate::PackageRoute,
    pub(crate) context: crate::PackageResolutionContext,
    pub(crate) context_inputs: Vec<PathBuf>,
    pub(crate) settings: PackageResolutionSettings,
    pub(crate) aliases: Vec<super::CompilerAlias>,
    pub(crate) settings_qualified: bool,
    pub(crate) aliases_qualified: bool,
    pub(crate) context_qualified: bool,
    pub(crate) raw_lookup_qualified: bool,
}

#[derive(Clone)]
pub(super) struct ReachabilityFacts {
    pub(super) failures: Vec<(PathBuf, &'static str, std::io::ErrorKind)>,
    pub(super) origin: Option<ReachabilityOrigin>,
}

pub(crate) struct ReachabilityEntry {
    pub(super) value: PackageRouteReachability,
    pub(super) facts: Consumed<ReachabilityFacts>,
}

impl Clone for ReachabilityEntry {
    fn clone(&self) -> Self {
        Self {
            value: self.value.clone(),
            facts: Consumed {
                value: self.facts.value.clone(),
                stamps: self.facts.stamps.clone(),
                qualified: self.facts.qualified,
            },
        }
    }
}

impl ReachabilityEntry {
    pub(super) fn empty() -> Self {
        Self {
            value: PackageRouteReachability::default(),
            facts: Consumed {
                value: ReachabilityFacts {
                    failures: Vec::new(),
                    origin: None,
                },
                stamps: Vec::new(),
                qualified: true,
            },
        }
    }
}

impl PackageCallback {
    pub(crate) fn needs_shadow(&self) -> bool {
        match self {
            Self::RuntimeSupport => false,
            Self::Occurrence(occurrence) => occurrence.needs_shadow,
        }
    }

    // Map an already-produced packet; never run the callback a second time.
    pub(crate) fn into_shadow_result(packet: Consumed<Self>) -> Consumed<bool> {
        Consumed {
            value: packet.value.needs_shadow(),
            stamps: packet.stamps,
            qualified: packet.qualified,
        }
    }
}

/// Retain only the inputs appended by this exact original callback.
/// A lost frontier refuses native qualification instead of panicking or inventing inputs.
pub(super) fn retain_package_inputs(
    stamps: &mut Vec<crate::package_route::stamp::InputStamp>,
    importer: &Path,
    inputs: &[PathBuf],
    input_start: usize,
) -> (Vec<PathBuf>, bool) {
    let Some(members) = inputs.get(input_start..) else {
        return (Vec::new(), false);
    };
    record_package_input_members(stamps, importer, members);
    (members.to_vec(), true)
}
