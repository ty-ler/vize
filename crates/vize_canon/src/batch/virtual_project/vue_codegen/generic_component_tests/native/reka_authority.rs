//! Genuine ReKa providers on the same diagnosing native reference owner.
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_macros,
    reason = "complete native reference-factory custody"
)]

mod fixture;
mod owned_vue_tsc;
#[path = "vuefes/rows.rs"]
mod rows;

use super::{native, packets};
use crate::{
    BatchTypeChecker, BatchTypeCheckerOptions, BatchTypeCheckerTrait,
    corsa_client::CorsaProjectClient, file_uri::path_to_file_uri,
};
use fixture::{TARGET, blob};
use serde_json::json;
use std::fs;

#[test]
fn pinned_reka_reference_owner_keeps_genuine_vue_types_through_wrong_and_repair() {
    if std::env::var("VIZE_TEST_REQUIRE_PIN_INPUT_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    let native = native().unwrap();
    let version = std::process::Command::new(&native)
        .arg("--version")
        .output()
        .unwrap();
    packets::retain(
        "reka-native-runtime",
        &json!({"nativeBinary":native,
        "wholeExecutable":blob(&fs::read(&native).unwrap()),
        "wholeVersionStdout":blob(&version.stdout),"wholeVersionStderr":blob(&version.stderr),
        "versionStatus":version.status.code()}),
    );
    assert!(version.status.success());
    let temporary = tempfile::tempdir().unwrap();
    let (root, roots, custody, prepared) = fixture::snapshot(temporary.path());
    packets::retain("reka-reference-fixture", &custody);
    owned_vue_tsc::observe(&prepared);
    let target = root.join(TARGET);
    let original = fs::read_to_string(&target).unwrap();
    let old = "open.value = false";
    let changed = "open.value = 'bad'";
    assert_eq!(old.len(), changed.len());
    assert_eq!(original.matches(old).count(), 1);
    let wrong = original.replace(old, changed);
    let options = BatchTypeCheckerOptions {
        tsconfig_path: Some(root.join(super::super::CONFIG_PATH)),
        ..Default::default()
    };
    packets::retain(
        "reka-reference-factory",
        &json!({
            "wholeOptionsDebug":format!("{options:#?}"),"serverCount":1,"checkerCount":1,
            "scope":"normal Batch reference factory with explicit existing core app config; public App CLI has no explicit config and its owner/options parity remains unproved",
        }),
    );
    let mut checker =
        BatchTypeChecker::with_options_and_corsa_path(&root, options, Some(&native)).unwrap();
    checker.set_server_count(Some(1));
    checker.set_checker_count(Some(1));
    checker.scan_paths(&roots).unwrap();
    let public = checker.check_project();
    packets::retain(
        "reka-reference-public-baseline",
        &json!({"wholePublicResult":format!("{public:#?}")}),
    );
    public.unwrap();
    let (mirror, config) = checker.native_project_paths_for_test();
    let config_bytes = fs::read(&config).unwrap();
    let mut client = CorsaProjectClient::new_for_workspace_config(
        Some(native.to_str().unwrap()),
        &mirror,
        &config,
    )
    .unwrap();
    let mut observations = Vec::new();
    for phase in ["baseline", "wrong", "repair"] {
        if phase != "baseline" {
            fs::write(&target, if phase == "wrong" { &wrong } else { &original }).unwrap();
            let public = checker.check_incremental(std::slice::from_ref(&target));
            packets::retain(
                &format!("reka-reference-public-{phase}"),
                &json!({"wholePublicResult":format!("{public:#?}")}),
            );
            public.unwrap();
            let refreshed = checker
                .virtual_files()
                .into_iter()
                .map(|file| file.virtual_path.clone())
                .collect::<Vec<_>>();
            client
                .refresh_materialized_files(&refreshed, &[], &[])
                .unwrap();
        }
        let files = checker.virtual_files();
        let requested = files
            .iter()
            .map(|file| path_to_file_uri(&file.virtual_path))
            .collect::<Vec<_>>();
        let target_uri = path_to_file_uri(
            &files
                .iter()
                .find(|file| file.original_path == target)
                .unwrap()
                .virtual_path,
        );
        client.begin_batch_test_receipt(true);
        let raw = client.request_diagnostics_batch(&requested).unwrap();
        let authority = client.batch_test_receipt(target_uri.as_str());
        let mapped = rows::map(&root, &files, &raw);
        let mut packet = json!({
            "phase":phase,"scope":"explicit-core-config normal Batch reference factory; no public App CLI owner or diagnostic acceptance credit",
            "nativeExecutable":native,"wholeNativeExecutable":blob(&fs::read(&native).unwrap()),
            "exactOriginal729VueRoots":roots,"requestedUris":requested,
            "nativeAuthority":authority,"wholeRawVector":raw,"wholeSevenFieldMappedVector":mapped,
            "authoredTarget":target,"wholeAuthoredTarget":blob(&fs::read(&target).unwrap()),
            "wholeGeneratedConfig":blob(&fs::read(&config).unwrap()),
            "wholeGeneratedProgram":files.iter().map(|file| json!({
                "originalPath":file.original_path,"virtualPath":file.virtual_path,
                "wholeCode":blob(file.content.as_bytes()),
                "wholeAuthoredSource":blob(&fs::read(&file.original_path).unwrap()),
                "wholeSourceMap":blob(format!("{:#?}", file.source_map).as_bytes()),
            })).collect::<Vec<_>>(),
        });
        packets::retain(&format!("reka-reference-{phase}"), &packet);
        let providers =
            client.batch_provider_receipt_for_test(target_uri.as_str(), &authority, blob);
        packet["pinnedPreparedProviderBinding"] = fixture::bind_native(&prepared, &providers);
        packet["sameDiagnosingOwnerProviderReads"] = providers;
        packets::retain(&format!("reka-reference-{phase}"), &packet);
        for root in &roots {
            assert!(files.iter().any(|file| file.original_path == *root));
        }
        assert_eq!(
            packet["sameDiagnosingOwnerProviderReads"]["qualified"],
            true
        );
        assert_eq!(packet["pinnedPreparedProviderBinding"]["qualified"], true);
        assert_eq!(authority["selectedConfig"], json!(config));
        assert_eq!(
            authority["project"]["compilerOptions"],
            authority["normalizedRequestedOptions"]
        );
        assert_eq!(authority["normalizedRequestedOptions"]["strict"], true);
        assert_eq!(authority["sourceFileNamesResponse"]["status"], "ok");
        assert_eq!(fs::read(&config).unwrap(), config_bytes);
        observations.push(mapped);
    }
    client.shutdown().unwrap();
    assert_eq!(fs::read(&target).unwrap(), original.as_bytes());
    let (line, column) =
        crate::batch::source_map::offset_to_line_col(&original, original.find(old).unwrap() as u32)
            .unwrap();
    let error = (
        TARGET.to_string(),
        Some(line),
        Some(column),
        Some("open.value".len() as u32),
        Some(2322),
        Some(1),
        "Type 'string' is not assignable to type 'boolean'.".to_string(),
    );
    let mut expected_wrong = observations[0].clone();
    expected_wrong.push(error);
    expected_wrong.sort();
    assert_eq!(
        observations[1], expected_wrong,
        "the genuine Vue ref must add only its complete TS2322"
    );
    assert_eq!(
        observations[2], observations[0],
        "exact source repair must restore the complete native vector"
    );
    fixture::assert_prepared_bytes(&prepared);
}
