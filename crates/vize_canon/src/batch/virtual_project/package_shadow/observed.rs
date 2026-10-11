//! Operation-local shadow facts; this sink never outlives the original pass.

use crate::package_route::stamp::Shared;
use std::path::{Path, PathBuf};

use super::super::VirtualProject;
use crate::batch::error::CorsaResult;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};

pub(in super::super) struct ShadowFacts {
    enabled: bool,
    facts: Consumed<()>,
    configuration: Shared<FactOwner>,
    owner: Shared<FactOwner>,
}

impl ShadowFacts {
    pub(in super::super) fn new(project: &VirtualProject, observe: bool) -> Self {
        let configuration = Shared::new(FactOwner {
            path: project.project_root.clone(),
            role: FactRole::Configuration,
        });
        Self {
            enabled: observe,
            facts: Consumed {
                value: (),
                stamps: Vec::new(),
                qualified: observe
                    && project.project_root.is_absolute()
                    && project.virtual_root.is_absolute(),
            },
            owner: configuration.clone(),
            configuration,
        }
    }

    /// Called only with the binding obtained by the original current registry
    /// lookup or values loop, never with a pending callback binding.
    pub(in super::super) fn binding(
        &mut self,
        binding: &crate::PackageRouteBinding,
    ) -> Shared<FactOwner> {
        let previous = self.owner.clone();
        self.owner = Shared::new(FactOwner {
            path: binding.importer_path.clone(),
            role: FactRole::LocalImporter,
        });
        self.facts.qualified &= binding.importer_path.is_absolute();
        previous
    }

    pub(in super::super) fn restore_owner(&mut self, owner: Shared<FactOwner>) {
        self.owner = owner;
    }

    pub(in super::super) fn configuration(&mut self) {
        self.owner = self.configuration.clone();
    }

    fn record(&mut self, path: &Path, stamp: InputStamp) {
        if self.enabled {
            self.facts.qualified &= path.is_absolute() && self.owner.path.is_absolute();
            self.facts.stamps.push(stamp.with_owner(self.owner.clone()));
        }
    }

    pub(in super::super) fn canonical(&mut self, path: &Path) -> PathBuf {
        let value = vize_carton::path::canonicalize_non_verbatim(path);
        if self.enabled {
            self.facts.qualified &= value.is_absolute();
            self.record(
                path,
                InputStamp::observed_canonical_path(path.to_path_buf(), value.clone()),
            );
        }
        value
    }

    pub(in super::super) fn is_file(&mut self, path: &Path) -> bool {
        let value = path.is_file();
        if self.enabled {
            self.record(
                path,
                InputStamp::observed_is_file(path.to_path_buf(), value),
            );
        }
        value
    }

    pub(in super::super) fn exists(&mut self, path: &Path) -> bool {
        let value = path.exists();
        if self.enabled {
            self.record(path, InputStamp::observed_exists(path.to_path_buf(), value));
        }
        value
    }

    pub(in super::super) fn mirrored(
        &mut self,
        project_root: &Path,
        virtual_root: &Path,
        path: &Path,
    ) -> CorsaResult<PathBuf> {
        let canonical = self.canonical(path);
        super::super::build::mirrored_canonical_virtual_path(project_root, virtual_root, &canonical)
    }

    pub(in super::super) fn finish(self) -> Consumed<()> {
        self.facts
    }
}
