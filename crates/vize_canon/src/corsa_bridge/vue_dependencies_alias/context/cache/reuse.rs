//! Move an invalidated slot's graph only when no immutable reader owns it.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use vize_carton::FxHashMap;

use super::super::build::consumption::NativeFacts;
use super::{ContextFingerprint, SessionCache};
use crate::corsa_bridge::vue_dependencies_alias::AliasContext;
use crate::package_route::stamp::{Consumed, FactRole};

mod patch;

#[derive(Debug, PartialEq, Eq)]
pub(in crate::corsa_bridge::vue_dependencies_alias::context) enum ReuseGuard {
    SourceInputs(super::fingerprint::SourceGuard),
    Namespace,
    Membership,
    SharedReader,
    SourcePatch,
}

impl ReuseGuard {
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn code(&self) -> u8 {
        match self {
            Self::SourceInputs(reason) => reason.code(),
            Self::Namespace => 8,
            Self::Membership => 9,
            Self::SharedReader => 10,
            Self::SourcePatch => 11,
        }
    }
}

pub(in crate::corsa_bridge::vue_dependencies_alias::context) struct RebuildFailure {
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) guard: ReuseGuard,
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) work: (usize, usize),
}

impl From<ReuseGuard> for RebuildFailure {
    fn from(guard: ReuseGuard) -> Self {
        Self {
            guard,
            work: (0, 0),
        }
    }
}

pub(in crate::corsa_bridge::vue_dependencies_alias::context) struct RebuildCandidate {
    fingerprint: ContextFingerprint,
    context: Arc<AliasContext>,
}

impl SessionCache {
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn get_for_rebuild(
        &mut self,
        source_path: &Path,
        fingerprint: &ContextFingerprint,
    ) -> (Option<Arc<AliasContext>>, Option<RebuildCandidate>) {
        if let Some(context) = self.get_inner(source_path, fingerprint, true) {
            return (Some(context), None);
        }
        let candidate = self
            .slots
            .remove(source_path)
            .map(|cached| RebuildCandidate {
                fingerprint: cached.fingerprint,
                context: cached.context,
            });
        (None, candidate)
    }
}

impl RebuildCandidate {
    #[expect(
        clippy::too_many_arguments,
        reason = "the exact current producer inputs qualify one owned graph"
    )]
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn rebuild(
        self,
        fingerprint: &ContextFingerprint,
        source_path: &Path,
        content: &str,
        overlays: &FxHashMap<PathBuf, &str>,
        requested_sources: &[(PathBuf, &str)],
        options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
        environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
    ) -> Result<Consumed<AliasContext>, RebuildFailure> {
        let changed = self
            .fingerprint
            .source_changes(
                fingerprint,
                &self.context,
                overlays,
                source_path,
                content.as_bytes(),
                requested_sources,
            )
            .map_err(ReuseGuard::SourceInputs)?;
        let mut facts = NativeFacts::new(true);
        let canonical = crate::batch::virtual_project::VirtualProject::canonical_configuration_path(
            source_path,
            true,
        );
        let configured = super::super::build::configured_project_observed(
            &canonical.value,
            options,
            environment,
        )
        .map_err(|_| ReuseGuard::Namespace)?;
        let root = configured.value.project_root().to_path_buf();
        facts.record(canonical, FactRole::Configuration, &root);
        let configured = facts.record(configured, FactRole::Configuration, &root);
        let old = self.context.mirror.as_ref().ok_or(ReuseGuard::Namespace)?;
        if configured.virtual_root() != old.virtual_root()
            || configured.project_root() != old.project_root()
            || configured.effective_tsconfig_path() != old.effective_tsconfig_path()
            || !old.source_options_match(&configured)
        {
            return Err(ReuseGuard::Namespace.into());
        }
        let host = facts.record(
            crate::batch::virtual_project::VirtualProject::canonical_configuration_path(
                source_path,
                true,
            ),
            FactRole::Configuration,
            &root,
        );
        let known = old.registered_original_paths_sorted();
        let mut seeds = vec![host.clone()];
        seeds.extend(
            environment
                .editor_session
                .cache()
                .project_sources_to_refresh(old.virtual_root(), fingerprint.overlay_identity())
                .into_iter()
                .filter(|path| path != &host && overlays.contains_key(path)),
        );
        seeds.extend(
            requested_sources
                .iter()
                .map(|(path, _)| vize_carton::path::canonicalize_non_verbatim(path)),
        );
        seeds.sort();
        seeds.dedup();
        // Match the original producer's explicit source membership. A known
        // deleted input may leave; unrelated live roots still rebuild cold.
        if seeds.iter().any(|path| !known.contains(path))
            || self
                .context
                .seed_paths
                .iter()
                .any(|path| !seeds.contains(path) && path.is_file())
        {
            return Err(ReuseGuard::Membership.into());
        }
        if !facts.is_qualified() {
            return Err(ReuseGuard::SourceInputs(
                super::fingerprint::SourceGuard::UnknownAuthority,
            )
            .into());
        }
        let mut context = Arc::try_unwrap(self.context).map_err(|_| ReuseGuard::SharedReader)?;
        context
            .mirror
            .as_mut()
            .ok_or(ReuseGuard::Namespace)?
            .discard_incremental_materialization();
        let mut resolver = environment.package_routes.clone();
        let patched = patch::apply_observed(
            &mut context,
            source_path,
            content,
            overlays,
            requested_sources,
            &changed,
            &seeds,
            &mut resolver,
            self.fingerprint.consumed_inputs(),
            &mut facts,
        );
        if patched.is_none() {
            return Err(RebuildFailure {
                guard: ReuseGuard::SourcePatch,
                work: context
                    .mirror
                    .as_ref()
                    .map_or((0, 0), |mirror| mirror.source_patch_work()),
            });
        }
        context.seed_paths = seeds;
        // Query surfaces contain revision-specific generated bytes and maps.
        context.query_surface = Default::default();
        #[cfg(test)]
        {
            context.graph_reused = true;
        }
        Ok(facts.finish(context))
    }
}

#[cfg(test)]
mod tests;
