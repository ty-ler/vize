//! Transfer one complete authored request to the existing native open operation.

use std::path::{Path, PathBuf};

use vize_carton::String;

use super::{
    CorsaBridge, CorsaBridgeError, CorsaProjectEnvironment, CorsaVueVirtualDocument,
    CorsaVueVirtualDocumentOptions, CorsaVueVirtualProject, VirtualTsOptions,
    build_vue_virtual_workspace_project,
};

pub(super) async fn open(
    bridge: &CorsaBridge,
    source_path: &Path,
    content: &str,
    options: CorsaVueVirtualDocumentOptions,
    overlays: &[(PathBuf, &str)],
    virtual_ts_options: &VirtualTsOptions,
    requested_sources: &[(PathBuf, &str)],
) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
    let source_path = source_path.to_path_buf();
    let content = String::from(content);
    let overlays = own_sources(overlays);
    let requested_sources = own_sources(requested_sources);
    let virtual_ts_options = virtual_ts_options.clone();
    let package_routes = bridge.package_route_resolver.clone();
    let editor_session = bridge.editor_session.clone();
    let config = bridge.config.clone();
    let profiling = bridge.profiler().is_enabled();
    let (host, cache_len, timer) = bridge
        .with_prepared_client(
            move || {
                let overlays = borrow_sources(&overlays);
                let requested_sources = borrow_sources(&requested_sources);
                build_vue_virtual_workspace_project(
                    &source_path,
                    &content,
                    options,
                    &overlays,
                    &requested_sources,
                    CorsaProjectEnvironment {
                        virtual_ts_options: &virtual_ts_options,
                        package_routes: &package_routes,
                        project_root: config.working_dir.as_deref(),
                        tsconfig_path: config.tsconfig_path.as_deref(),
                        editor_session: &editor_session,
                    },
                )
            },
            move |client, project| {
                let CorsaVueVirtualProject {
                    host,
                    documents,
                    session_project_root,
                    session_config_path,
                    materialized_changes,
                } = project;
                let phase = crate::corsa_bridge::preparation_trace::Phase::start(
                    "project_synchronize",
                    documents.len(),
                );
                let timer = profiling
                    .then(|| vize_carton::profiler::Timer::start("corsa_project_synchronize"));
                if let Some(project_root) = session_project_root {
                    client
                        .synchronize_materialized_project(
                            &project_root,
                            session_config_path.as_deref(),
                            &materialized_changes,
                        )
                        .map_err(CorsaBridgeError::CommunicationError)?;
                }
                // This is the original boundary between synchronization and
                // opening the batch; a retired caller must not enter the latter.
                crate::corsa_bridge::native_operation::checkpoint()
                    .map_err(CorsaBridgeError::CommunicationError)?;
                let documents = documents
                    .iter()
                    .map(|(uri, content)| (uri.as_str(), content.as_str()))
                    .collect::<Vec<_>>();
                client
                    .did_open_batch_fast(&documents)
                    .map_err(CorsaBridgeError::CommunicationError)?;
                let cache_len = client.diagnostics_cache_len();
                phase.finish();
                Ok((host, cache_len, timer))
            },
        )
        .await?;
    bridge.cache_stats().set_entries(cache_len as u64);
    if let Some(timer) = timer {
        timer.record(bridge.profiler());
    }
    Ok(host)
}

fn own_sources(sources: &[(PathBuf, &str)]) -> Vec<(PathBuf, String)> {
    sources
        .iter()
        .map(|(path, source)| (path.clone(), String::from(*source)))
        .collect()
}

fn borrow_sources(sources: &[(PathBuf, String)]) -> Vec<(PathBuf, &str)> {
    sources
        .iter()
        .map(|(path, source)| (path.clone(), source.as_str()))
        .collect()
}

#[cfg(test)]
mod tests;
