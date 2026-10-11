//! Original callback result and same-entry reachability facts.

use crate::batch::virtual_project::PackageRouteReachability;
use crate::batch::virtual_project::package_resolution::PackageResolutionSettings;
use crate::package_route::stamp::Consumed;
use std::path::PathBuf;

pub(crate) enum PackageCallback {
    RuntimeSupport,
    Occurrence(PackageOccurrence),
}

pub(crate) struct PackageOccurrence {
    pub(crate) source_options: crate::PackageSourceOptions,
    pub(crate) context: crate::PackageResolutionContext,
    pub(crate) context_inputs: Vec<PathBuf>,
    pub(crate) raw_lookup: crate::PackageRouteLookup,
    pub(crate) reachability: PackageRouteReachability,
    pub(crate) failures: Vec<(PathBuf, &'static str, std::io::ErrorKind)>,
    pub(crate) reachability_origin: Option<ReachabilityOrigin>,
    pub(crate) needs_shadow: bool,
    pub(crate) track_reachability: bool,
    pub(crate) watchable_negative: bool,
    pub(crate) route_inputs: Vec<PathBuf>,
    pub(crate) binding: Option<crate::PackageRouteBinding>,
    // Emission into a pending Vec is not current registered graph-root authority.
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
