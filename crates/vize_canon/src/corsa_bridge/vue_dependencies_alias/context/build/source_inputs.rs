//! The same original explicit/open source registration phase.
use super::{NativeFacts, SourceRevision, bridge_error};
use crate::batch::virtual_project::VirtualProject;
use crate::corsa_bridge::{types::CorsaBridgeError, vue_document::CorsaProjectEnvironment};
use crate::package_route::stamp::FactRole;
use std::path::{Path, PathBuf};
use vize_carton::FxHashMap;

#[expect(
    clippy::too_many_arguments,
    reason = "the original registration phase receives the same native inputs"
)]
pub(super) fn register(
    project: &mut VirtualProject,
    source_path: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    revision: &SourceRevision<'_>,
    environment: CorsaProjectEnvironment<'_>,
    facts: &mut NativeFacts,
    root: &Path,
    observe: bool,
) -> Result<Vec<PathBuf>, CorsaBridgeError> {
    let mut seed_paths = vec![source_path.to_path_buf()];
    let register_phase = crate::corsa_bridge::preparation_trace::Phase::start(
        "alias_register_inputs",
        revision.requested_sources.len() + 1,
    );
    if observe {
        facts.record_owned(
            project
                .register_path_with_content_observed(source_path, content)
                .map_err(bridge_error)?,
        );
    } else {
        project
            .register_path_with_content(source_path, content)
            .map_err(bridge_error)?;
    }
    facts.body(source_path, content.as_bytes());
    // An overlay edit invalidates generated contexts, not live membership.
    // Rebuild previously registered open sources in the same project revision
    // before stale contexts are pruned. Otherwise querying a dependency would
    // delete its still-open importer and recreate it on the next query.
    let live_sources = environment
        .editor_session
        .cache()
        .project_sources_to_refresh(project.virtual_root(), revision.overlay_identity);
    for path in live_sources {
        if path != source_path
            && let Some(source) = overlays.get(&path)
        {
            if observe {
                facts.record_owned(
                    project
                        .register_path_with_content_observed(&path, source)
                        .map_err(bridge_error)?,
                );
            } else {
                project
                    .register_path_with_content(&path, source)
                    .map_err(bridge_error)?;
            }
            facts.body(&path, source.as_bytes());
            seed_paths.push(path);
        }
    }
    for (path, source) in revision.requested_sources {
        let path = facts.record(
            VirtualProject::canonical_configuration_path(path, observe),
            FactRole::Configuration,
            root,
        );
        if path == source_path {
            continue;
        }
        let source = overlays.get(&path).copied().unwrap_or(source);
        if observe {
            facts.record_owned(
                project
                    .register_path_with_content_observed(&path, source)
                    .map_err(bridge_error)?,
            );
        } else {
            project
                .register_path_with_content(&path, source)
                .map_err(bridge_error)?;
        }
        facts.body(&path, source.as_bytes());
        seed_paths.push(path);
    }
    seed_paths.sort();
    seed_paths.dedup();
    register_phase.finish();
    Ok(seed_paths)
}
