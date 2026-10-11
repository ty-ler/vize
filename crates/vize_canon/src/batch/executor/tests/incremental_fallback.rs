use super::{CorsaExecutor, fs, unique_case_dir};
use crate::batch::{IncrementalCheckMetrics, VirtualProject};
use std::os::unix::fs::PermissionsExt;

#[test]
fn incremental_session_fallback_is_counted_per_check() {
    let _fallback_guard = super::super::fallback::FALLBACK_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    let case_dir = unique_case_dir("incremental-session-fallback-metrics");
    let _ = fs::remove_dir_all(&case_dir);
    let cache_dir = case_dir.join(".cache");
    let source = case_dir.join("src").join("main.ts");
    fs::create_dir_all(&cache_dir).unwrap();
    fs::create_dir_all(case_dir.join("node_modules")).unwrap();
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, "const value: number = 1;\n").unwrap();

    // The project-session protocol exits before its handshake. The ordinary
    // CLI succeeds, making the degradation deterministic without a real Corsa
    // runtime and letting the metrics prove it was not silently hidden.
    let tsgo = cache_dir.join("tsgo");
    fs::write(
        &tsgo,
        "#!/bin/sh\nif [ \"$1\" = \"--api\" ]; then printf 'api unavailable'; exit 0; fi\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&tsgo, fs::Permissions::from_mode(0o755)).unwrap();

    let mut project = VirtualProject::new(&case_dir).unwrap();
    project.register_path(&source).unwrap();
    let executor = CorsaExecutor::new(&case_dir).unwrap();
    let result = executor
        .check_incremental_session(&mut project, Some(1))
        .expect("the CLI fallback should keep the check successful");

    assert!(result.success);
    assert!(result.diagnostics.is_empty());
    let metrics = executor.incremental_metrics();
    assert!(
        metrics.last_materialized_entries_considered >= metrics.last_requested_files,
        "{metrics:?}"
    );
    assert_eq!(
        metrics.last_tree_entries_scanned,
        metrics.last_materialized_entries_considered
    );
    assert_eq!(
        metrics,
        IncrementalCheckMetrics {
            checks: 1,
            session_to_cli_fallbacks: 1,
            last_session_to_cli_fallback: true,
            last_requested_files: 1,
            last_materialized_entries_considered: metrics.last_materialized_entries_considered,
            last_tree_entries_scanned: metrics.last_materialized_entries_considered,
            last_full_rebuild: true,
            ..Default::default()
        }
    );

    let _ = fs::remove_dir_all(&case_dir);
}

#[test]
fn failed_incremental_cli_fallback_retains_the_complete_first_session_error() {
    use crate::{batch::error::CorsaError, corsa_client::CorsaProjectClient};
    use sha2::{Digest, Sha256};

    let _fallback_guard = super::super::fallback::FALLBACK_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let case_dir = unique_case_dir("incremental-failed-fallback-precedence");
    let _ = fs::remove_dir_all(&case_dir);
    fs::create_dir_all(case_dir.join("src")).unwrap();
    let source = case_dir.join("src/main.ts");
    fs::write(&source, "const value: number = 1;\n").unwrap();
    let tsgo = case_dir.join("tsgo");
    let fixture = include_str!(
        "../../../../../../tests/_fixtures/differential/typechecker/incremental-fallback-precedence/case.json"
    );
    assert_eq!(
        &Sha256::digest(fixture.as_bytes())[..],
        &[
            0x04, 0x36, 0x89, 0xa6, 0xcb, 0xcb, 0xe6, 0xfe, 0x89, 0x29, 0x48, 0x81, 0x68, 0x66,
            0x3e, 0xa3, 0x2a, 0x50, 0xd0, 0x1c, 0x25, 0x99, 0xfe, 0x68, 0x67, 0xbb, 0xaf, 0x3d,
            0xf0, 0x40, 0x28, 0xf2
        ],
    );
    let case: serde_json::Value = serde_json::from_str(fixture).unwrap();
    assert_eq!(case["schemaVersion"], 1);
    assert_eq!(case["id"], "incremental-fallback-precedence");
    assert_eq!(case["expectedSessionErrorExitCode"], -1);
    assert_eq!(case["checks"], 2);
    fs::write(&tsgo, case["runtime"].as_str().unwrap()).unwrap();
    fs::set_permissions(&tsgo, fs::Permissions::from_mode(0o755)).unwrap();
    let mut project = VirtualProject::new(&case_dir).unwrap();
    project.register_path(&source).unwrap();
    project.materialize().unwrap();
    let executor = CorsaExecutor::with_corsa_path(&case_dir, Some(&tsgo)).unwrap();
    let path = executor.corsa_path().to_string_lossy();
    let first = match CorsaProjectClient::new_for_workspace_config(
        Some(path.as_ref()),
        project.virtual_root(),
        &project.generated_tsconfig_path(),
    ) {
        Ok(_) => panic!("the unchanged fixture protocol must fail before a session starts"),
        Err(message) => CorsaError::CorsaExecution {
            exit_code: -1,
            message,
        },
    };
    // Preserve the literal process packet independently from the existing
    // public error format, which strips terminal whitespace.
    let raw = std::process::Command::new(&tsgo)
        .arg("--project")
        .arg(project.generated_tsconfig_path())
        .output()
        .unwrap();
    assert_eq!(
        i64::from(raw.status.code().unwrap()),
        case["expectedRawCliError"]["exitCode"].as_i64().unwrap()
    );
    assert_eq!(
        raw.stdout,
        case["expectedRawCliError"]["stdout"]
            .as_str()
            .unwrap()
            .as_bytes()
    );
    assert_eq!(
        raw.stderr,
        case["expectedRawCliError"]["stderr"]
            .as_str()
            .unwrap()
            .as_bytes()
    );
    let fallback = super::super::check_with_cli(executor.corsa_path(), &project, 1).unwrap_err();
    match &fallback {
        CorsaError::CorsaExecution { exit_code, message } => {
            assert_eq!(
                i64::from(*exit_code),
                case["expectedCliError"]["exitCode"].as_i64().unwrap()
            );
            assert_eq!(
                message.as_str(),
                case["expectedCliError"]["message"].as_str().unwrap()
            );
        }
        other => panic!("the complete CLI failure packet must remain observable: {other}"),
    }
    eprintln!("first session error: {first}\nfailed CLI fallback: {fallback}");
    for checks in 1..=2 {
        let actual = executor
            .check_incremental_session(&mut project, Some(1))
            .unwrap_err();
        assert_eq!(
            vize_carton::cstr!("{actual}"),
            vize_carton::cstr!("{first}")
        );
        let metrics = executor.incremental_metrics();
        assert_eq!(metrics.checks, checks);
        assert_eq!(metrics.session_to_cli_fallbacks, checks);
        assert!(metrics.last_session_to_cli_fallback);
        assert_eq!(metrics.session_starts, 0);
        assert_eq!(metrics.session_reuses, 0);
    }
    let _ = fs::remove_dir_all(&case_dir);
}
