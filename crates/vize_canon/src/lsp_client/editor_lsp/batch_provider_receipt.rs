//! Test-only source reads on the native owner that just returned diagnostics.
#![expect(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    reason = "cfg(test) authority violations must fail qualification"
)]

use super::{
    CorsaProjectClient,
    snapshot_source::{SnapshotSourceOwner, SourceTextOutcome},
};
use corsa::api::ApiClient;
use serde_json::{Value, json};
use std::{fs, path::Path};
use vize_l0::cstr;

impl CorsaProjectClient {
    pub(crate) fn batch_provider_receipt_for_test(
        &mut self,
        uri: &str,
        authority: &Value,
        retain: impl Fn(&[u8]) -> Value,
    ) -> Value {
        assert_eq!(authority["nativeBinary"], json!(self.executable));
        let config = Path::new(authority["selectedConfig"].as_str().unwrap());
        match authority["mode"].as_str() {
            Some("editor-lsp") => {
                let editor = self.editor_lsp.as_mut().unwrap();
                let selected = editor.diagnosing_configuration(uri).unwrap_or_else(|_| {
                    panic!("the existing diagnosing LSP must retain its configuration")
                });
                assert_eq!(selected, config);
                // This is the retained attachment to this diagnosing LSP, not
                // a new process or a separately started project API oracle.
                let attachment = editor.configured_api.as_ref().unwrap();
                assert_eq!(json!(attachment.session), authority["attachment"]);
                let mut receipt = read_sources(&attachment.client, config, authority, retain);
                receipt["diagnosingAttachment"] = json!(attachment.session);
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
    let observation = {
        let project = owner.project(config).unwrap().unwrap_or_else(|reason| {
            panic!("the same native snapshot refused its configured project: {reason:?}")
        });
        let same_project = json!(project.descriptor()) == authority["project"];
        let same_sources =
            json!(project.source_names()) == authority["sourceFileNamesResponse"]["wholeResponse"];
        let mut sources = Vec::new();
        for name in project.source_names().iter().filter(|name| {
            name.ends_with("/vue/dist/vue.d.ts")
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
            sources.push(json!({
                "nativeSourceName":name,"nativeFileName":text.file_name(),
                "nativePath":text.path(),"nativeUri":text.uri(),"physical":physical,
                "completeNativeText":retain(text.text().as_bytes()),
                "wholeEncodedPayload":retain(text.encoded_bytes()),
                "completePhysicalBytes":retain(&disk),"nativeMatchesPhysical":matches,
            }));
        }
        let missing = [
            "/vue/dist/vue.d.ts",
            "/@vue/runtime-core/dist/runtime-core.d.ts",
        ]
        .into_iter()
        .filter(|suffix| {
            !sources.iter().any(|source| {
                source["nativeSourceName"]
                    .as_str()
                    .is_some_and(|name| name.ends_with(suffix))
            })
        })
        .collect::<Vec<_>>();
        json!({
            "ownerScope":"the retained attachment/session that returned this phase's diagnostics",
            "snapshotHandle":owner.handle(),"project":project.descriptor(),
            "wholeSourceNames":project.source_names(),"loadedProviderSources":sources,
            "sameDiagnosingProject":same_project,"sameDiagnosingSourceNames":same_sources,
            "missingRequiredProviders":missing,
            "qualified":same_project && same_sources && missing.is_empty()
                && sources.iter().all(|source| source["nativeMatchesPhysical"] == true),
            "additionalReadScope":"selected loaded Vue/Nuxt/helper providers only; all source names are retained, unqueried bytes receive no read credit",
        })
    };
    owner.release().unwrap();
    observation
}
