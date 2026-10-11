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
    use crate::batch::error::CorsaError;
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
            0x33, 0xbe, 0x59, 0xfb, 0xa6, 0x67, 0x46, 0xbd, 0xba, 0xc1, 0x99, 0xd4, 0xe2, 0x54,
            0x1c, 0xe8, 0x26, 0xf5, 0xb8, 0xa6, 0x57, 0xb2, 0x04, 0xef, 0x50, 0x5d, 0xc7, 0xcd,
            0x2f, 0xa9, 0x86, 0x8e
        ],
    );
    let case: serde_json::Value = serde_json::from_str(fixture).unwrap();
    assert_eq!(case["schemaVersion"], 1);
    assert_eq!(case["id"], "incremental-fallback-precedence");
    assert_eq!(case["expectedSessionErrorExitCode"], -1);
    assert_eq!(case["checks"], 2);
    fs::write(&tsgo, case["runtime"].as_str().unwrap()).unwrap();
    fs::set_permissions(&tsgo, fs::Permissions::from_mode(0o755)).unwrap();
    // Validate the exact real wire response separately, including process exit
    // and both raw streams. Closing stdin is an actual owner operation.
    let decode = |hex: &str| {
        assert_eq!(hex.len() % 2, 0);
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect::<Vec<_>>()
    };
    let mut api = std::process::Command::new(&tsgo)
        .arg("--api")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(
        &mut api.stdin.take().unwrap(),
        &decode(case["expectedRawApiError"]["requestHex"].as_str().unwrap()),
    )
    .unwrap();
    let raw_api = api.wait_with_output().unwrap();
    assert_eq!(
        i64::from(raw_api.status.code().unwrap()),
        case["expectedRawApiError"]["exitCode"].as_i64().unwrap()
    );
    assert_eq!(
        raw_api.stdout,
        decode(case["expectedRawApiError"]["stdoutHex"].as_str().unwrap())
    );
    assert_eq!(
        raw_api.stderr,
        case["expectedRawApiError"]["stderr"]
            .as_str()
            .unwrap()
            .as_bytes()
    );
    fs::remove_file(case_dir.join(".api-call-count")).unwrap();
    let mut project = VirtualProject::new(&case_dir).unwrap();
    project.register_path(&source).unwrap();
    project.materialize().unwrap();
    let executor = CorsaExecutor::with_corsa_path(&case_dir, Some(&tsgo)).unwrap();
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
    for checks in 1..=2 {
        OBSERVED_FALLBACKS.lock().unwrap().clear();
        let actual = tracing::subscriber::with_default(FallbackRecorder, || {
            executor
                .check_incremental_session(&mut project, Some(1))
                .unwrap_err()
        });
        let packets = std::mem::take(&mut *OBSERVED_FALLBACKS.lock().unwrap());
        // The actual first warning is independent of the later retained-error
        // event. Separate API handshakes can have different complete IO errors.
        let first = packets
            .first()
            .expect("the first session refusal is recorded");
        assert_eq!(first.step.as_deref(), Some("SessionToCli"));
        let first_error = first.error.as_ref().unwrap();
        assert_eq!(vize_carton::cstr!("{actual}"), *first_error);
        assert_eq!(
            first_error.as_str(),
            case["expectedSessionError"].as_str().unwrap()
        );
        assert!(matches!(
            actual,
            CorsaError::CorsaExecution { exit_code: -1, .. }
        ));
        let retained = packets.last().expect("both failed paths remain recorded");
        assert_eq!(retained.error.as_ref(), Some(first_error));
        let failed_cli = retained.failed_cli.as_ref().unwrap();
        assert_eq!(
            failed_cli.as_str(),
            case["expectedFailedFallbackPacket"].as_str().unwrap()
        );
        eprintln!(
            "actual first session error: {first_error}\nactual failed CLI fallback: {failed_cli}"
        );
        let metrics = executor.incremental_metrics();
        assert_eq!(metrics.checks, checks);
        assert_eq!(metrics.session_to_cli_fallbacks, checks);
        assert!(metrics.last_session_to_cli_fallback);
        assert_eq!(metrics.session_starts, 0);
        assert_eq!(metrics.session_reuses, 0);
    }
    assert_eq!(
        fs::read_to_string(case_dir.join(".api-call-count")).unwrap(),
        case["expectedApiCalls"].as_u64().unwrap().to_string()
    );
    let _ = fs::remove_dir_all(&case_dir);
}

#[derive(Default)]
struct FallbackPacket {
    step: Option<vize_carton::String>,
    error: Option<vize_carton::String>,
    failed_cli: Option<vize_carton::String>,
}

static OBSERVED_FALLBACKS: std::sync::Mutex<Vec<FallbackPacket>> =
    std::sync::Mutex::new(Vec::new());

struct FallbackRecorder;

impl tracing::field::Visit for FallbackPacket {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let value = vize_carton::cstr!("{value:?}");
        match field.name() {
            "fallback" => self.step = Some(value),
            "error" => self.error = Some(value),
            "fallback_error" => self.failed_cli = Some(value),
            _ => {}
        }
    }
}

impl tracing::Subscriber for FallbackRecorder {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        metadata.target() == "vize_canon::corsa::fallback"
    }

    fn new_span(&self, _span: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        if !self.enabled(event.metadata()) {
            return;
        }
        let mut packet = FallbackPacket::default();
        event.record(&mut packet);
        OBSERVED_FALLBACKS.lock().unwrap().push(packet);
    }

    fn enter(&self, _span: &tracing::span::Id) {}

    fn exit(&self, _span: &tracing::span::Id) {}
}
