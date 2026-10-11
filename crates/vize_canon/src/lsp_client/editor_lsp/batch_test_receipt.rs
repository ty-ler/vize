//! Test-only attestation from the same client that returned Batch diagnostics.

use super::super::diagnostics::test_route::{self, Route};
use super::{CorsaProjectClient, EditorLspSession, project_identity::ProjectIdentityError};
use corsa::runtime::block_on;
use serde_json::{Value, json};
use std::path::Path;

impl CorsaProjectClient {
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
            // Preserve the original overlay-only gate, including its refusal.
            // A Batch request can have already diagnosed this materialized URI
            // in an earlier chunk, outside the last live overlay map.
            receipt["originalOverlayConfigurationObservation"] =
                match editor.diagnosing_configuration(uri) {
                    Ok(path) => json!({"status":"ok","selectedConfig":path}),
                    Err(error) => json!({"status":"refused","wholeError":match error {
                        ProjectIdentityError::Communication(error) => error,
                        ProjectIdentityError::Unconfigured =>
                            "native document is inferred or unconfigured".into(),
                    }}),
                };
            let observed = materialized_configuration_receipt(editor, uri);
            receipt["selectedConfig"] = observed["selectedConfig"].clone();
            if observed["status"] != "ok" {
                receipt["configurationError"] = observed["wholeError"].clone();
            }
            receipt["materializedConfigurationObservation"] = observed;
            match editor.configured_project_receipt(uri) {
                Ok(observed) => {
                    for key in [
                        "project",
                        "snapshotProjects",
                        "normalizedRequestedOptions",
                        "normalizedRequestedFiles",
                        "attachment",
                        "sourceFileNamesRequest",
                        "sourceFileNamesResponse",
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
            let request =
                json!({"snapshot":session.snapshot().handle,"project":session.project().id});
            receipt["sourceFileNamesRequest"] = request.clone();
            receipt["sourceFileNamesResponse"] = match corsa::runtime::block_on(
                session
                    .client()
                    .raw_json_request("getSourceFileNames", request),
            ) {
                Ok(value) => json!({"status":"ok","wholeResponse":value}),
                Err(error) => json!({"status":"error","wholeError":vize_l0::cstr!("{error}")}),
            };
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

/// Query the existing diagnosing LSP, without opening or replacing an overlay.
pub(super) fn materialized_configuration_receipt(
    editor: &mut EditorLspSession,
    uri: &str,
) -> Value {
    struct ProjectInfoRequest;
    impl lsp_types::request::Request for ProjectInfoRequest {
        type Params = Value;
        type Result = Value;
        const METHOD: &'static str = "custom/projectInfo";
    }

    let request = json!({"textDocument":{"uri":uri}});
    let mut receipt = json!({
        "method":"custom/projectInfo","wholeRequest":request,
        "scope":"same already-diagnosing LSP, acknowledged materialized Batch URI; no overlay or owner replacement",
        "status":"refused","selectedConfig":null,
    });
    if let Err(error) = editor.ready_workspace_request() {
        receipt["wholeError"] = json!(error);
        return receipt;
    }
    receipt["acknowledgedDocumentGeneration"] = json!(editor.document_generation);
    match block_on(editor.client.request::<ProjectInfoRequest>(request)) {
        Ok(response) => {
            let selected = response
                .get("configFilePath")
                .and_then(Value::as_str)
                .filter(|path| !path.is_empty() && Path::new(path).is_absolute())
                .map(std::path::PathBuf::from);
            receipt["wholeResponse"] = response;
            if let Some(selected) = selected {
                receipt["status"] = json!("ok");
                receipt["selectedConfig"] = json!(selected);
            } else {
                receipt["wholeError"] =
                    json!("native materialized document is inferred or unconfigured");
            }
        }
        Err(error) => receipt["wholeError"] = json!(vize_l0::cstr!("{error}")),
    }
    receipt
}
