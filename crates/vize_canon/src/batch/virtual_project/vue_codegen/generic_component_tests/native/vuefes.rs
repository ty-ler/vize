//! Actual same-owner VueFes reference-factory configuration and provider law.
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_macros,
    reason = "complete native and source custody"
)]

mod fixture;
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
fn pinned_vuefes_reference_factory_keeps_real_configured_vue_types_through_wrong_and_repair() {
    if std::env::var("VIZE_TEST_REQUIRE_PIN_INPUT_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    let native = native().unwrap();
    let version = std::process::Command::new(&native)
        .arg("--version")
        .output()
        .unwrap();
    packets::retain(
        "vuefes-native-runtime",
        &json!({"nativeBinary":native,
        "wholeExecutable":blob(&fs::read(&native).unwrap()),
        "wholeVersionStdout":blob(&version.stdout),"wholeVersionStderr":blob(&version.stderr),
        "versionStatus":version.status.code()}),
    );
    assert!(version.status.success());
    let temporary = tempfile::tempdir().unwrap();
    let (root, roots, custody) = fixture::snapshot(temporary.path());
    packets::retain("vuefes-reference-fixture", &custody);
    let target = root.join(TARGET);
    let original = fs::read_to_string(&target).unwrap();
    let old = "isMoved.value = true;";
    let changed = "isMoved.value = 'no';";
    assert_eq!(old.len(), changed.len());
    assert_eq!(original.matches(old).count(), 1);
    let wrong = original.replace(old, changed);
    let mut checker = BatchTypeChecker::with_options_and_corsa_path(
        &root,
        BatchTypeCheckerOptions::default(),
        Some(&native),
    )
    .unwrap();
    checker.set_server_count(Some(1));
    checker.set_checker_count(Some(1));
    checker.scan_paths(&roots).unwrap();
    let baseline_public = checker.check_project();
    packets::retain(
        "vuefes-reference-public-baseline",
        &json!({"wholePublicResult":format!("{baseline_public:#?}")}),
    );
    baseline_public.unwrap();
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
                &format!("vuefes-reference-public-{phase}"),
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
            "phase":phase,"scope":"normal Batch reference factory, not the public CLI's Nuxt factory or native owner",
            "nativeExecutable":native,"nativeExecutableBytes":blob(&fs::read(&native).unwrap()),
            "exactOriginal71VueRoots":roots,"requestedUris":requested,
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
        packets::retain(&format!("vuefes-reference-{phase}"), &packet);
        packet["sameDiagnosingOwnerProviderReads"] =
            client.batch_provider_receipt_for_test(target_uri.as_str(), &authority, blob);
        packets::retain(&format!("vuefes-reference-{phase}"), &packet);
        for root in &roots {
            assert!(files.iter().any(|file| file.original_path == *root));
        }
        assert_eq!(
            packet["sameDiagnosingOwnerProviderReads"]["qualified"],
            true
        );
        assert_eq!(authority["selectedConfig"], json!(config));
        assert_eq!(
            authority["project"]["compilerOptions"],
            authority["normalizedRequestedOptions"]
        );
        assert_eq!(authority["normalizedRequestedOptions"]["strict"], true);
        assert_eq!(authority["sourceFileNamesResponse"]["status"], "ok");
        assert_eq!(fs::read(&config).unwrap(), config_bytes);
        observations.push((phase, mapped));
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
        Some("isMoved.value".len() as u32),
        Some(2322),
        Some(1),
        "Type 'string' is not assignable to type 'boolean'.".to_string(),
    );
    let mut expected_wrong = observations[0].1.clone();
    expected_wrong.push(error);
    expected_wrong.sort();
    assert_eq!(
        observations[1].1, expected_wrong,
        "the genuine Vue ref must add only its complete TS2322"
    );
    assert_eq!(
        observations[2].1, observations[0].1,
        "exact source repair must restore the complete native vector"
    );
}
