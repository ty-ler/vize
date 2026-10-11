//! Vue virtual-document synchronization for editor Corsa sessions.

use std::path::{Path, PathBuf};

use vize_carton::String;

use super::bridge::CorsaBridge;
use super::types::CorsaBridgeError;
use super::vue_dependencies::{collect_dependency_documents, tsx_vue_import_shim};
use crate::batch::{ImportRewriter, VueDocumentVirtualTsOptions};
use crate::file_uri::path_to_file_uri;
use crate::virtual_ts::VirtualTsOptions;

pub(in crate::corsa_bridge) mod build;
pub(super) mod materialized_documents;
use build::build_vue_virtual_workspace_project;
#[path = "vue_document/types.rs"]
mod model;
mod workspace_open;
pub(crate) use model::CorsaVueVirtualProject;
pub(super) use model::GeneratedVueDocument;
pub use model::{
    CorsaMaterializedMappingKind, CorsaMaterializedSource, CorsaVueVirtualDependency,
    CorsaVueVirtualDocument, CorsaVueVirtualDocumentOptions,
};

pub(crate) use model::CorsaProjectEnvironment;

impl CorsaBridge {
    /// Forget deleted source owners without waiting for native IPC.
    ///
    /// Exclusive ownership retires any outstanding preparation caller first;
    /// background publication checks that lease under the same cache lock.
    /// The next native request flushes disk invalidation before synchronizing
    /// the materialized delta.
    pub fn mark_deleted_vue_virtual_documents(&mut self, source_paths: &[PathBuf]) {
        if source_paths.is_empty() {
            return;
        }
        super::vue_dependencies_alias::AliasContext::forget_cached_sources(
            &self.editor_session,
            source_paths,
        );
        self.mark_disk_project_state_dirty();
    }

    /// Remove virtual TypeScript overlays derived from deleted Vue SFCs.
    pub async fn forget_vue_virtual_documents(
        &self,
        source_paths: &[PathBuf],
    ) -> Result<(), CorsaBridgeError> {
        super::vue_dependencies_alias::AliasContext::forget_cached_sources(
            &self.editor_session,
            source_paths,
        );
        let source_paths = source_paths.to_vec();
        self.with_client(move |client| {
            client
                .forget_vue_virtual_documents(&source_paths)
                .map_err(CorsaBridgeError::CommunicationError)
        })
        .await
    }

    /// Generate, sync, and return the canonical `.vue.{ts,tsx}` document used
    /// for editor diagnostics, hover, definition, references, and rename.
    pub async fn open_vue_virtual_document(
        &self,
        source_path: &Path,
        content: &str,
        options: CorsaVueVirtualDocumentOptions,
    ) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
        self.open_vue_virtual_document_with_overlays(source_path, content, options, &[])
            .await
    }

    /// Generate and sync a Vue document while preferring unsaved dependency
    /// buffers over their on-disk contents.
    pub async fn open_vue_virtual_document_with_overlays(
        &self,
        source_path: &Path,
        content: &str,
        options: CorsaVueVirtualDocumentOptions,
        overlays: &[(PathBuf, String)],
    ) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
        self.open_vue_virtual_document_with_overlays_and_options(
            source_path,
            content,
            options,
            overlays,
            &VirtualTsOptions::default(),
        )
        .await
    }

    /// Generate and sync a Vue document with editor-specific virtual-TS options.
    pub async fn open_vue_virtual_document_with_overlays_and_options(
        &self,
        source_path: &Path,
        content: &str,
        options: CorsaVueVirtualDocumentOptions,
        overlays: &[(PathBuf, String)],
        virtual_ts_options: &VirtualTsOptions,
    ) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
        let overlays = overlays
            .iter()
            .map(|(path, content)| (path.clone(), content.as_str()))
            .collect::<Vec<_>>();
        self.open_vue_virtual_document_with_borrowed_overlays_and_options(
            source_path,
            content,
            options,
            &overlays,
            virtual_ts_options,
        )
        .await
    }

    /// Capture one authored buffer revision for the retained native worker.
    /// Reachable and registered sources share the same captured source bytes.
    pub async fn open_vue_virtual_document_with_borrowed_overlays_and_options(
        &self,
        source_path: &Path,
        content: &str,
        options: CorsaVueVirtualDocumentOptions,
        overlays: &[(PathBuf, &str)],
        virtual_ts_options: &VirtualTsOptions,
    ) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
        self.open_vue_virtual_workspace_document(
            source_path,
            content,
            options,
            overlays,
            virtual_ts_options,
            &[],
        )
        .await
    }

    /// Register a complete query surface and synchronize one native revision.
    /// Workspace references should not rebuild the project once per SFC.
    pub async fn open_vue_virtual_workspace_document(
        &self,
        source_path: &Path,
        content: &str,
        options: CorsaVueVirtualDocumentOptions,
        overlays: &[(PathBuf, &str)],
        virtual_ts_options: &VirtualTsOptions,
        requested_sources: &[(PathBuf, &str)],
    ) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
        workspace_open::open(
            self,
            source_path,
            content,
            options,
            overlays,
            virtual_ts_options,
            requested_sources,
        )
        .await
    }

    /// Retain complete immutable editor snapshots on the existing native worker.
    /// Unchanged buffers keep their original owners rather than copying text.
    #[expect(
        clippy::disallowed_types,
        reason = "actual immutable editor buffer snapshots already have shared Arc owners"
    )]
    pub async fn open_vue_virtual_workspace_document_with_shared_sources(
        &self,
        source_path: &Path,
        content: &str,
        options: CorsaVueVirtualDocumentOptions,
        overlays: &[(PathBuf, std::sync::Arc<str>)],
        virtual_ts_options: &VirtualTsOptions,
        requested_sources: &[(PathBuf, std::sync::Arc<str>)],
    ) -> Result<CorsaVueVirtualDocument, CorsaBridgeError> {
        workspace_open::open_owned(
            self,
            source_path.to_path_buf(),
            String::from(content),
            options,
            overlays.to_vec(),
            virtual_ts_options.clone(),
            requested_sources.to_vec(),
        )
        .await
    }

    pub(super) async fn open_canon_project_documents(
        &self,
        documents: Vec<(String, String)>,
        session_project_root: Option<PathBuf>,
        session_config_path: Option<PathBuf>,
        materialized_changes: crate::batch::virtual_project::MaterializedFileDelta,
    ) -> Result<(), CorsaBridgeError> {
        let phase = super::preparation_trace::Phase::start("project_synchronize", documents.len());
        let timer = self.profiler().timer("corsa_project_synchronize");
        if let Some(project_root) = session_project_root {
            self.with_client(move |client| {
                client
                    .synchronize_materialized_project(
                        &project_root,
                        session_config_path.as_deref(),
                        &materialized_changes,
                    )
                    .map_err(CorsaBridgeError::CommunicationError)
            })
            .await?;
        }
        self.open_owned_virtual_documents_batch(documents).await?;
        phase.finish();
        if let Some(timer) = timer {
            timer.record(self.profiler());
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn build_vue_virtual_project(
    source_path: &Path,
    content: &str,
    options: CorsaVueVirtualDocumentOptions,
) -> Result<CorsaVueVirtualProject, CorsaBridgeError> {
    build_vue_virtual_project_with_overlays(source_path, content, options, &[])
}

#[cfg(test)]
pub(crate) fn build_vue_virtual_project_with_overlays(
    source_path: &Path,
    content: &str,
    options: CorsaVueVirtualDocumentOptions,
    overlays: &[(PathBuf, &str)],
) -> Result<CorsaVueVirtualProject, CorsaBridgeError> {
    build_vue_virtual_project_with_overlays_and_options(
        source_path,
        content,
        options,
        overlays,
        &VirtualTsOptions::default(),
    )
}

#[cfg(test)]
fn build_vue_virtual_project_with_overlays_and_options(
    source_path: &Path,
    content: &str,
    options: CorsaVueVirtualDocumentOptions,
    overlays: &[(PathBuf, &str)],
    virtual_ts_options: &VirtualTsOptions,
) -> Result<CorsaVueVirtualProject, CorsaBridgeError> {
    build_vue_virtual_project_with_overlays_and_options_and_package_routes(
        source_path,
        content,
        options,
        overlays,
        CorsaProjectEnvironment {
            virtual_ts_options,
            package_routes: &crate::PackageRouteResolver::default(),
            project_root: None,
            tsconfig_path: None,
            editor_session: super::editor_session::fallback_editor_session(),
        },
    )
}

pub(crate) fn build_vue_virtual_project_with_overlays_and_options_and_package_routes(
    source_path: &Path,
    content: &str,
    options: CorsaVueVirtualDocumentOptions,
    overlays: &[(PathBuf, &str)],
    environment: CorsaProjectEnvironment<'_>,
) -> Result<CorsaVueVirtualProject, CorsaBridgeError> {
    build_vue_virtual_workspace_project(source_path, content, options, overlays, &[], environment)
}

/// Generate Vue output with offset-preserving Canon alias identities (#3900).
pub(super) fn generate_vue_document_with_alias(
    source_path: &Path,
    content: &str,
    options: CorsaVueVirtualDocumentOptions,
    rewriter: &ImportRewriter,
    context: &super::vue_dependencies_alias::AliasContext,
) -> Result<GeneratedVueDocument, CorsaBridgeError> {
    generate_vue_document_with_options(
        source_path,
        content,
        options,
        context.virtual_ts_options(),
        rewriter,
        Some(context),
    )
}

#[path = "vue_document/generate.rs"]
mod generate;
use generate::generate_vue_document_with_options;
