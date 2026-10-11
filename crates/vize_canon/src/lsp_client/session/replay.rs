//! Retained editor buffers belong to the owner, not to one native snapshot.

use super::{CorsaProjectClient, materialize_session_document};
use corsa::{
    api::{FileChangeSummary, FileChanges},
    runtime::block_on,
};
use vize_l0::{String, cstr};

impl CorsaProjectClient {
    pub(in crate::lsp_client) fn synchronize_materialized_project_documents(
        &mut self,
        documents: &[(&str, &str)],
    ) -> Result<(), String> {
        // Startup must see the complete batch, including a typed overlay API
        // fallback while replay temporarily owns the retained document map.
        for (uri, content) in documents {
            self.document_texts.insert((*uri).into(), (*content).into());
        }
        self.editor_lsp_documents_dirty = true;
        self.activate_materialized_project_session()?;
        let mut summary = FileChangeSummary::default();
        for (uri, content) in documents {
            self.clear_document_state(uri);
            let document_uri = self.materialized_session_document_uri(uri).ok_or_else(|| {
                cstr!("Failed to derive materialized Corsa overlay path for {uri}")
            })?;
            if let Some(FileChanges::Summary(delta)) =
                materialize_session_document(uri, document_uri.as_str(), content)
            {
                summary.changed.extend(delta.changed);
                summary.created.extend(delta.created);
            }
        }
        // All new members now exist before one owner reload; content-only
        // batches use one refresh instead of refreshing each document.
        self.refresh_materialized_overlay_snapshot(Some(FileChanges::Summary(summary)))
    }

    pub(in crate::lsp_client) fn refresh_materialized_overlay_snapshot(
        &mut self,
        file_changes: Option<FileChanges>,
    ) -> Result<(), String> {
        if !self.has_project_session() {
            return Ok(());
        }
        if matches!(&file_changes, Some(FileChanges::Summary(summary)) if !summary.created.is_empty())
        {
            return self.reload_materialized_project_transport();
        }
        block_on(self.project_session_mut()?.refresh(file_changes))
            .map_err(|error| cstr!("Failed to refresh Corsa snapshot: {error}"))
    }

    pub(in crate::lsp_client) fn reload_materialized_project_transport(
        &mut self,
    ) -> Result<(), String> {
        // A native summary refresh does not discover a new include member.
        // Reap the old physical owner before opening the complete disk project;
        // content-only edits continue to refresh its existing snapshot.
        let root = self.editor_lsp_project_root();
        let config = self
            .explicit_project_config
            .clone()
            .unwrap_or_else(|| crate::lsp_client::lifecycle_setup::workspace_config_path(&root));
        self.retire_project_session()?;
        self.replace_project_transport(&config, &root)
    }

    pub(in crate::lsp_client) fn ensure_project_transport(&mut self) -> Result<(), String> {
        if !self.closed && self.shared_editor_transport && !self.has_project_session() {
            crate::corsa_bridge::native_operation::checkpoint()?;
            self.ensure_editor_transport()?;
        }
        Ok(())
    }

    pub(in crate::lsp_client) fn replay_retained_project_documents(
        &mut self,
    ) -> Result<(), String> {
        // The new native snapshot has never received these bytes. Temporarily
        // take the retained map so the ordinary batch writer cannot treat an
        // unchanged buffer as an already-synchronized native overlay. Reuse its
        // single-refresh and typed materialization fallback, preserving every
        // buffer even when synchronization fails partway through the batch.
        let retained = std::mem::take(&mut self.document_texts);
        let documents = retained
            .iter()
            .map(|(uri, content)| (uri.as_str(), content.as_str()))
            .collect::<Vec<_>>();
        let result = self.did_open_batch_fast(&documents);
        for (uri, content) in retained {
            self.document_texts.entry(uri).or_insert(content);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::CorsaProjectClient;

    #[test]
    fn materialized_batch_retains_every_input_before_a_preparation_failure() {
        let root = tempfile::tempdir().unwrap();
        let mut client = CorsaProjectClient::empty_for_test(root.path().to_path_buf());
        let documents = [
            ("invalid-uri", "export const first = 'unsaved';\n"),
            ("another-invalid-uri", "export const second = 42;\n"),
        ];
        client.editor_lsp_documents_dirty = false;
        assert!(
            client
                .synchronize_materialized_project_documents(&documents)
                .is_err()
        );
        assert_eq!(client.document_texts.len(), documents.len());
        for (uri, source) in documents {
            assert_eq!(client.document_texts.get(uri).unwrap(), source);
        }
        assert!(client.editor_lsp_documents_dirty);
        assert!(!client.materialized_project_session);
        assert!(client.session.is_none());
        assert!(client.editor_lsp.is_none());
    }

    #[test]
    fn editor_only_replay_retains_every_complete_buffer_without_starting_a_transport() {
        let root = tempfile::tempdir().unwrap();
        let mut client = CorsaProjectClient::empty_for_test(root.path().to_path_buf());
        let buffers = [
            (
                "file:///workspace/first.ts",
                "export const first = 'unsaved';\n",
            ),
            ("file:///workspace/second.ts", "export const second = 42;\n"),
        ];
        client.did_open_batch_fast(&buffers).unwrap();
        let original = client.document_texts.clone();
        client.replay_retained_project_documents().unwrap();
        assert_eq!(client.document_texts, original);
        assert!(client.session.is_none());
        assert!(client.editor_lsp.is_none());
        assert!(client.editor_lsp_documents_dirty);
    }

    #[test]
    fn failed_replay_restores_every_complete_retained_buffer() {
        let root = tempfile::tempdir().unwrap();
        let mut client = CorsaProjectClient::empty_for_test(root.path().to_path_buf());
        client
            .document_texts
            .insert("invalid-uri".into(), "first\n".into());
        client
            .document_texts
            .insert("another-invalid-uri".into(), "second\n".into());
        let original = client.document_texts.clone();
        client.materialized_project_session = true;
        assert!(client.replay_retained_project_documents().is_err());
        assert_eq!(client.document_texts, original);
        assert!(client.session.is_none());
        assert!(client.editor_lsp.is_none());
    }
}
