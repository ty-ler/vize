//! Test-only attestation from the same client that returned Batch diagnostics.

use super::super::diagnostics::test_route::{self, Route};
use super::snapshot_source::{SnapshotSourceOwner, SourceTextOutcome};
use super::{CorsaProjectClient, project_identity::ProjectIdentityError};
use serde_json::{Value, json};
use std::{fs, path::Path};

impl CorsaProjectClient {
    /// Read the complete leaf declaration on the attachment that diagnosed this batch.
    pub(crate) fn batch_test_leaf_source(&mut self, uri: &str, authority: &Value) -> Value {
        assert_eq!(authority["mode"], "editor-lsp");
        assert_eq!(authority["nativeBinary"], json!(self.executable));
        let editor = self.editor_lsp.as_mut().unwrap();
        let config = editor.diagnosing_configuration(uri).unwrap_or_else(|_| {
            panic!("the actual diagnosing owner must retain its configuration")
        });
        assert_eq!(json!(config), authority["selectedConfig"]);
        let attachment = editor.configured_api.as_ref().unwrap();
        assert_eq!(json!(attachment.session), authority["attachment"]);
        let mut owner = SnapshotSourceOwner::create(&attachment.client).unwrap();
        let observation = {
            let project = owner.project(&config).unwrap().unwrap();
            let same_project = json!(project.descriptor()) == authority["project"];
            let same_sources = json!(project.source_names()) == authority["sourceNamesResponse"];
            let sources: Vec<_> = project.source_names().iter()
                .filter(|name| Path::new(name.as_str()).ends_with("node_modules/leaf-types/index.d.ts"))
                .map(|name| {
                    let uri = crate::file_uri::path_to_file_uri(Path::new(name.as_str()));
                    match project.read(uri.as_str()).unwrap() {
                        SourceTextOutcome::Complete(text) => {
                            let physical = fs::canonicalize(text.file_name()).unwrap();
                            let bytes = fs::read(&physical).unwrap();
                            json!({"nativeSourceName":name,"nativeFileName":text.file_name(),
                                "nativePath":text.path(),"nativeUri":text.uri(),"physical":physical,
                                "completeNativeText":text.text().as_bytes(),
                                "wholeEncodedPayload":text.encoded_bytes(),"completePhysicalBytes":bytes,
                                "nativeMatchesPhysical":bytes == text.text().as_bytes()})
                        }
                        SourceTextOutcome::Refused { reason, encoded } => json!({
                            "nativeSourceName":name,"nativeMatchesPhysical":false,
                            "nativeReadRefusal":vize_l0::cstr!("{reason:?}"),
                            "wholeEncodedRefusal":encoded.as_ref().map(|value|value.as_bytes()),
                        }),
                    }
                }).collect::<Vec<_>>();
            json!({"scope":"retained diagnosing attachment","attachment":attachment.session,
                "snapshotHandle":owner.handle(),"project":project.descriptor(),
                "wholeSourceNames":project.source_names(),"loadedLeafSources":sources,
                "sameDiagnosingProject":same_project,"sameDiagnosingSourceNames":same_sources,
                "qualified":same_project && same_sources && sources.len() == 1
                    && sources.iter().all(|source|source["nativeMatchesPhysical"] == true)})
        };
        owner.release().unwrap();
        observation
    }
}

impl CorsaProjectClient {
    pub(crate) fn batch_test_process_observer(
        &self,
    ) -> Option<corsa_lsp::process::ProcessObserver> {
        self.editor_lsp
            .as_ref()
            .map(|editor| editor.process_observer.clone())
    }

    pub(crate) fn batch_test_receipt(&mut self, uri: &str) -> Value {
        let mut receipt = json!({
            "nativeBinary": self.executable, "cwd": self.cwd,
            "workspaceRoot": self.project_root,
            "startupCpu": null, "nativeProgramCount": null, "diagnosticGroups": null,
        });
        let route = test_route::take();
        if route == Some(Route::Editor) {
            let Some(editor) = self.editor_lsp.as_mut() else {
                return receipt;
            };
            receipt["mode"] = json!("editor-lsp");
            receipt["nativeInitializeResponse"] = editor.native_initialize_response.clone();
            receipt["nativeShutdownMode"] = json!(if editor.shutdown_to_eof {
                "authenticated-native-7.0.2-shutdown-eof"
            } else {
                "standard-sdk-shutdown-exit"
            });
            let processes = editor.process_observer.receipts();
            receipt["processPid"] = json!(processes.first().map(|r| r.pid));
            let selected = editor.diagnosing_configuration(uri);
            match selected {
                Ok(path) => receipt["selectedConfig"] = json!(path),
                Err(error) => {
                    receipt["selectedConfig"] = Value::Null;
                    receipt["configurationError"] = json!(match error {
                        ProjectIdentityError::Communication(error) => error,
                        ProjectIdentityError::Unconfigured =>
                            "native document is inferred or unconfigured".into(),
                    });
                }
            }
            match editor.configured_project_receipt(uri) {
                Ok(observed) => {
                    for key in [
                        "project",
                        "snapshotProjects",
                        "normalizedRequestedOptions",
                        "normalizedRequestedFiles",
                        "attachment",
                        "sourceNamesRequest",
                        "sourceNamesResponse",
                    ] {
                        receipt[key] = observed[key].clone();
                    }
                }
                Err(error) => receipt["observationError"] = json!(error),
            }
        } else if route == Some(Route::Api) {
            let Some(session) = &self.session else {
                return receipt;
            };
            receipt["mode"] = json!("project-api");
            receipt["selectedConfig"] = json!(session.project().config_file_name);
            receipt["project"] = json!(session.project());
            receipt["snapshotProjects"] = json!(session.snapshot().projects);
            match corsa::runtime::block_on(session.client().parse_config_file(
                corsa::api::DocumentIdentifier::from(session.project().config_file_name.as_str()),
            )) {
                Ok(parsed) => {
                    receipt["normalizedRequestedOptions"] = parsed.options;
                    receipt["normalizedRequestedFiles"] = json!(parsed.file_names);
                }
                Err(error) => receipt["observationError"] = json!(vize_l0::cstr!("{error}")),
            }
        } else {
            receipt["mode"] = json!("unknown");
            receipt["selectedConfig"] = Value::Null;
        }
        receipt
    }
}
