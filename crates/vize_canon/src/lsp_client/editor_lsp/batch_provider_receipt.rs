//! Test-only source reads on the native owner that just returned diagnostics.
#![expect(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    reason = "cfg(test) authority violations must fail qualification"
)]

use super::{
    CorsaProjectClient,
    batch_test_receipt::materialized_configuration_receipt,
    snapshot_source::{SnapshotSourceOwner, SourceTextOutcome},
};
use corsa::api::ApiClient;
use serde_json::{Value, json};
use std::{fs, path::Path};
use vize_l0::cstr;

mod provider_export;

impl CorsaProjectClient {
    pub(crate) fn batch_provider_receipt_for_test(
        &mut self,
        uri: &str,
        authority: &Value,
        retain: impl Fn(&[u8]) -> Value,
    ) -> Value {
        assert_eq!(authority["nativeBinary"], json!(self.executable));
        let Some(selected_config) = authority["selectedConfig"].as_str() else {
            return json!({"qualified":false,"refusal":"no actual diagnosing config selection",
                "wholeConfigurationObservation":authority["materializedConfigurationObservation"]});
        };
        let config = Path::new(selected_config);
        match authority["mode"].as_str() {
            Some("editor-lsp") => {
                let editor = self.editor_lsp.as_mut().unwrap();
                let selected = materialized_configuration_receipt(editor, uri);
                if selected["status"] != "ok"
                    || selected["selectedConfig"] != authority["selectedConfig"]
                {
                    return json!({"qualified":false,
                        "refusal":"the existing diagnosing LSP did not retain its actual selection",
                        "wholeConfigurationObservation":selected});
                }
                // This is the retained attachment to this diagnosing LSP, not
                // a new process or a separately started project API oracle.
                let attachment = editor.configured_api.as_ref().unwrap();
                assert_eq!(json!(attachment.session), authority["attachment"]);
                let mut receipt = read_sources(&attachment.client, config, authority, retain);
                receipt["diagnosingAttachment"] = json!(attachment.session);
                receipt["wholeConfigurationObservation"] = selected;
                receipt
            }
            Some("project-api") => {
                let session = self.session.as_ref().unwrap();
                assert_eq!(
                    Path::new(session.project().config_file_name.as_str()),
                    config
                );
                read_sources(session.client(), config, authority, retain)
            }
            _ => panic!("unknown or mixed diagnostics owner cannot attest providers"),
        }
    }
}

fn read_sources(
    client: &ApiClient,
    config: &Path,
    authority: &Value,
    retain: impl Fn(&[u8]) -> Value,
) -> Value {
    let mut owner = SnapshotSourceOwner::create(client).unwrap();
    let observation = (|| {
        let original = match owner.project(config).unwrap() {
            Ok(project) => json!({"status":"admitted","wholeProject":project.descriptor(),
                "wholeSourceNames":project.source_names()}),
            Err(reason) => json!({"status":"refused","wholeRefusal":cstr!("{reason:?}")}),
        };
        let whole_projects = json!(owner.whole_batch_snapshot_projects_for_test());
        let controls =
            owner.batch_project_identity_refusals_for_test(config, &authority["project"]);
        let project = match owner
            .batch_project_for_test(config, &authority["project"])
            .unwrap()
        {
            Ok(project) => project,
            Err(reason) => {
                return json!({"qualified":false,"wholeRefusal":cstr!("{reason:?}"),
                "wholeSnapshotProjects":whole_projects,"originalSingletonAdmission":original,
                "identityRefusalControls":controls});
            }
        };
        let same_project = json!(project.descriptor()) == authority["project"];
        let same_sources =
            json!(project.source_names()) == authority["sourceFileNamesResponse"]["wholeResponse"];
        let absent_uri = crate::file_uri::path_to_file_uri(
            &config.with_file_name("__vize_absent_provider_read__.d.ts"),
        );
        let foreign_uri = "file:///__vize_foreign_snapshot__/vue.d.ts";
        let mut source_refusals = Vec::new();
        for uri in [absent_uri.as_str(), foreign_uri] {
            let refused = match project.read(uri).unwrap() {
                SourceTextOutcome::Refused { reason, encoded } => json!({
                    "uri":uri,"refused":true,"wholeRefusal":cstr!("{reason:?}"),
                    "wholeEncodedRefusal":encoded.as_ref().map(|value|retain(value.as_bytes())),
                }),
                SourceTextOutcome::Complete(text) => json!({"uri":uri,"refused":false,
                    "unexpectedWholeNativeText":retain(text.text().as_bytes())}),
            };
            source_refusals.push(refused);
        }
        let mut sources = Vec::new();
        for name in project.source_names().iter().filter(|name| {
            name.ends_with("/vue/dist/vue.d.ts")
                || name.ends_with("/vue/dist/vue.d.mts")
                || name.ends_with("/@vue/runtime-core/dist/runtime-core.d.ts")
                || name.ends_with("/.nuxt/imports.d.ts")
                || name.ends_with("/__vize_shared_helpers.d.ts")
        }) {
            let uri = crate::file_uri::path_to_file_uri(Path::new(name.as_str()));
            let read = project.read(uri.as_str()).unwrap();
            let text = match read {
                SourceTextOutcome::Complete(text) => text,
                SourceTextOutcome::Refused { reason, encoded } => {
                    sources.push(json!({"nativeSourceName":name,"nativeMatchesPhysical":false,
                        "nativeReadRefusal":cstr!("{reason:?}"),
                        "wholeEncodedRefusal":encoded.as_ref().map(|value| retain(value.as_bytes())),
                    }));
                    continue;
                }
            };
            let physical = fs::canonicalize(text.file_name()).unwrap();
            let disk = fs::read(&physical).unwrap();
            let matches = disk == text.text().as_bytes();
            let export =
                if name.ends_with("/vue/dist/vue.d.ts") || name.ends_with("/vue/dist/vue.d.mts") {
                    provider_export::receipt(name.as_str(), &physical, &retain)
                } else {
                    json!({"qualified":true,"scope":"not a Vue package entrypoint"})
                };
            sources.push(json!({
                "nativeSourceName":name,"nativeFileName":text.file_name(),
                "nativePath":text.path(),"nativeUri":text.uri(),"physical":physical,
                "completeNativeText":retain(text.text().as_bytes()),
                "wholeEncodedPayload":retain(text.encoded_bytes()),
                "completePhysicalBytes":retain(&disk),"nativeMatchesPhysical":matches,
                "providerExport":export,
            }));
        }
        let missing = [
            "/vue/dist/vue.d.ts",
            "/@vue/runtime-core/dist/runtime-core.d.ts",
        ]
        .into_iter()
        .filter(|suffix| {
            !sources.iter().any(|source| {
                source["nativeSourceName"].as_str().is_some_and(|name| {
                    name.ends_with(suffix)
                        || *suffix == "/vue/dist/vue.d.ts" && name.ends_with("/vue/dist/vue.d.mts")
                })
            })
        })
        .collect::<Vec<_>>();
        json!({
            "ownerScope":"the retained attachment/session that returned this phase's diagnostics",
            "snapshotHandle":owner.handle(),"project":project.descriptor(),
            "wholeSnapshotProjects":whole_projects,"originalSingletonAdmission":original,
            "identityRefusalControls":controls,"sourceRefusalControls":source_refusals,
            "selectionScope":"test-only exact config and complete diagnosing descriptor; production singleton contract is unchanged",
            "wholeSourceNames":project.source_names(),"loadedProviderSources":sources,
            "sameDiagnosingProject":same_project,"sameDiagnosingSourceNames":same_sources,
            "missingRequiredProviders":missing,
            "qualified":same_project && same_sources && missing.is_empty()
                && ["absentProjectRefused","foreignDescriptorRefused","duplicateProjectRefused","changedWholeDescriptorRefused"]
                    .iter().all(|name|controls[*name] == true)
                && source_refusals.iter().all(|refusal|refusal["refused"] == true)
                && sources.iter().all(|source| source["nativeMatchesPhysical"] == true
                    && source["providerExport"]["qualified"] == true),
            "additionalReadScope":"selected loaded Vue/Nuxt/helper providers only; all source names are retained, unqueried bytes receive no read credit",
        })
    })();
    owner.release().unwrap();
    observation
}
