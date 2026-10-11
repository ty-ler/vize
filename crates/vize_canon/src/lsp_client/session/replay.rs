//! Retained editor buffers belong to the owner, not to one native snapshot.

use super::CorsaProjectClient;
use vize_l0::String;

impl CorsaProjectClient {
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
