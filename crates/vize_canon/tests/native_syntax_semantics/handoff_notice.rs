use super::{Command, native};

/// A parser abort is a mandatory semantic phase, so the public fallback notice
/// must remain available for an actual transport/runtime failure later on.
#[test]
fn required_semantic_completion_does_not_report_runtime_degradation() {
    let Some(native) = native() else { return };
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "actual_native_syntax_and_semantic_errors_survive_and_repair_clears_only_the_semantic_error",
            "--nocapture",
        ])
        .env("CORSA_PATH", native)
        .env("VIZE_TEST_REQUIRE_TSGO", "1")
        .env_remove("VIZE_SILENCE_CORSA_FALLBACK")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
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
    assert_eq!(
        stderr, "",
        "required same-config completion was reported as degradation: {stderr}"
    );
}
