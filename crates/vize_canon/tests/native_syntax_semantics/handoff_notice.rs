use super::{Command, check, fs, install, native, retain_packet, rows};
use std::{
    collections::BTreeMap,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tracing::{Event, Metadata, Subscriber, field::Visit, span};

const CHILD: &str = "VIZE_TEST_HANDOFF_NOTICE_CHILD";
const TARGET: &str = "vize_canon::corsa::fallback";
const CLI_FAILURE: &str = "native CLI intentionally unavailable";

#[derive(Clone, Default)]
struct FallbackEvents(Arc<Mutex<Vec<BTreeMap<String, String>>>>);

struct Fields(BTreeMap<String, String>);

impl Visit for Fields {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.0.insert(field.name().to_owned(), value.to_owned());
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

impl Subscriber for FallbackEvents {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target() == TARGET
    }

    fn new_span(&self, _: &span::Attributes<'_>) -> span::Id {
        span::Id::from_u64(1)
    }

    fn record(&self, _: &span::Id, _: &span::Record<'_>) {}
    fn record_follows_from(&self, _: &span::Id, _: &span::Id) {}
    fn enter(&self, _: &span::Id) {}
    fn exit(&self, _: &span::Id) {}

    fn event(&self, event: &Event<'_>) {
        if !self.enabled(event.metadata()) {
            return;
        }
        let mut fields = Fields(BTreeMap::from([
            ("target".into(), event.metadata().target().into()),
            ("level".into(), event.metadata().level().to_string()),
        ]));
        event.record(&mut fields);
        self.0.lock().unwrap().push(fields.0);
    }
}

/// A parser abort is a mandatory semantic phase, so the public fallback notice
/// must remain available for an actual transport/runtime failure later on.
#[test]
fn required_semantic_completion_does_not_report_runtime_degradation() {
    let Some(native) = native() else { return };
    if let Some(mode) = std::env::var_os(CHILD) {
        assert_eq!(mode, "1");
        let events = FallbackEvents::default();
        // A child-only global subscriber also observes worker threads, without
        // capturing unrelated tests running concurrently in the parent process.
        tracing::subscriber::set_global_default(events.clone()).unwrap();
        super::actual_native_syntax_and_semantic_errors_survive_and_repair_clears_only_the_semantic_error();
        assert_eq!(*events.0.lock().unwrap(), Vec::new());
        assert_real_runtime_degradation(&native, &events);
        return;
    }
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "handoff_notice::required_semantic_completion_does_not_report_runtime_degradation",
            "--nocapture",
        ])
        .env(CHILD, "1")
        .env("CORSA_PATH", native)
        .env("VIZE_TEST_REQUIRE_TSGO", "1")
        .env_remove("VIZE_SILENCE_CORSA_FALLBACK")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    retain_packet(
        "handoff-notice-child",
        &serde_json::json!({"exitCode":output.status.code(),
            "wholeStdout":output.stdout,"wholeStderr":output.stderr}),
    );
    // Native stderr has a different producer from Vize's structured warning.
    // Keep every byte observable; this test does not certify native shutdown.
    std::io::stderr().write_all(&output.stderr).unwrap();
    assert!(output.status.success(), "{output:?}");
    let lines = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    assert_eq!(
        lines.first().copied(),
        Some("running 1 test"),
        "the native corpus filter must execute its test: {output:?}"
    );
    let summary = lines.last().unwrap().split("; ").collect::<Vec<_>>();
    let [result, failed, ignored, measured, _, _] = summary.as_slice() else {
        panic!("missing complete native test result: {stdout}");
    };
    assert_eq!(
        (*result, *failed, *ignored, *measured),
        (
            "test result: ok. 1 passed",
            "0 failed",
            "0 ignored",
            "0 measured"
        ),
        "{stdout}"
    );
    let notices = stderr
        .lines()
        .filter(|line| line.starts_with("\u{1b}[33mwarning:\u{1b}[0m corsa: "))
        .collect::<Vec<_>>();
    assert_eq!(
        notices,
        [format!(
            "\u{1b}[33mwarning:\u{1b}[0m corsa: Corsa CLI fast path unavailable; degraded to the slower project-session API (check failure: corsa error (exit code 42): {CLI_FAILURE}). Type checking continues on a slower path."
        )]
    );
}

fn wrapper(root: &Path, native: &Path, transport: Option<i32>) -> PathBuf {
    let bin = root.join(".bin");
    fs::create_dir_all(&bin).unwrap();
    let native = native.to_string_lossy().replace('\'', "'\"'\"'");
    let command = if let Some(code) = transport {
        let peer = bin.join("diagnostic-refusal.ts");
        fs::write(&peer, include_str!("diagnostic_refusal.ts")).unwrap();
        let peer = peer.to_string_lossy().replace('\'', "'\"'\"'");
        let capture = bin.join("refusal.json");
        let capture = capture.to_string_lossy().replace('\'', "'\"'\"'");
        format!(
            "case \"$1\" in --api) exec node '{peer}' '{capture}' '{code}' \"$@\";; esac\nexec '{native}' \"$@\""
        )
    } else {
        format!(
            "case \"$1\" in --api|--lsp) exec '{native}' \"$@\";; esac\nprintf '%s\\n' '{CLI_FAILURE}' >&2\nexit 42"
        )
    };
    let path = bin.join("native-handoff-control");
    fs::write(&path, format!("#!/bin/sh\n{command}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn assert_real_runtime_degradation(native: &Path, events: &FallbackEvents) {
    let project = tempfile::tempdir().unwrap();
    install(project.path(), true);
    let wrapper = wrapper(project.path(), native, None);
    let result = check(project.path(), &wrapper).expect("real native session must complete");
    assert!(!result.success);
    assert_eq!(
        rows(project.path(), &result),
        vec![
            (
                "Injected.vue".into(),
                1,
                6,
                Some(2322),
                1,
                "Type 'string' is not assignable to type 'number'.".into()
            ),
            (
                "post-request.d.ts".into(),
                1293,
                0,
                Some(1128),
                1,
                "Declaration or statement expected.".into()
            ),
        ]
    );
    let expected = BTreeMap::from([
        ("target".into(), TARGET.into()),
        ("level".into(), "WARN".into()),
        ("fallback".into(), "CliToSession".into()),
        ("cause".into(), "check".into()),
        (
            "error".into(),
            format!("corsa error (exit code 42): {CLI_FAILURE}"),
        ),
        (
            "message".into(),
            "Corsa CLI fast path unavailable; degraded to the slower project-session API".into(),
        ),
    ]);
    let actual = events.0.lock().unwrap().clone();
    retain_packet("handoff-fallback-events", &serde_json::json!(actual));
    assert_eq!(actual, [expected]);
}

#[test]
fn cancelled_and_failed_semantic_requests_cannot_report_completion() {
    let Some(native) = native() else { return };
    for (code, message) in [
        (-32800, "context canceled"),
        (-32603, "semantic request failed"),
    ] {
        let project = tempfile::tempdir().unwrap();
        install(project.path(), true);
        let wrapper = wrapper(project.path(), &native, Some(code));
        let error = check(project.path(), &wrapper)
            .expect_err("a failed semantic response must not complete the parser handoff");
        let vize_canon::CorsaError::CorsaExecution {
            exit_code,
            message: actual,
        } = error
        else {
            panic!("semantic refusal must be an execution failure: {error:#?}");
        };
        assert_eq!(exit_code, 1);
        assert_eq!(
            actual.as_str(),
            format!(
                "corsa error (exit code 1): Corsa CLI semantic diagnostics are incomplete after a syntax error:\npost-request.d.cts(1294,1): error TS1128: Declaration or statement expected.\nSame-config native diagnostic completion failed: corsa error (exit code -1): Failed to request Corsa project diagnostics: rpc error {code}: {message}"
            )
        );
        let packet: serde_json::Value =
            serde_json::from_slice(&fs::read(project.path().join(".bin/refusal.json")).unwrap())
                .unwrap();
        retain_packet(&format!("handoff-semantic-refusal-{code}"), &packet);
        assert_eq!(packet["request"]["method"], "getDiagnosticsForProject");
        assert_eq!(
            packet["request"]["params"],
            serde_json::json!({"snapshot":"denied-snapshot", "project":"denied-project"})
        );
        assert_eq!(
            packet["response"],
            serde_json::json!({"jsonrpc":"2.0", "id":packet["request"]["id"], "error":{"code":code,"message":message}})
        );
    }
}
