//! Whole source-authored packets for inherited attributes in existing template ASTs.

use serde_json::{Value, json};
use vize_patina::output::{OutputFormat, format_results};
use vize_patina::{LintPreset, LintResult, Linter, Severity};

const RULE: &str = "script/no-duplicate-attr-inheritance";

fn whole(result: &LintResult) -> Value {
    json!({
        "filename": result.filename, "error_count": result.error_count,
        "warning_count": result.warning_count,
        "diagnostics": result.diagnostics.iter().map(|d| json!({
            "rule_name": d.rule_name, "severity": d.severity, "message": d.message,
            "start": d.start, "end": d.end, "help": d.help, "fix": d.fix,
            "labels": d.labels.iter().map(|label| json!({
                "message": label.message, "start": label.start, "end": label.end
            })).collect::<Vec<_>>()
        })).collect::<Vec<_>>()
    })
}

#[test]
fn original_theme_icon_and_neighbors_preserve_twenty_five_whole_packets() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../tests/_fixtures/differential/lint/attrs-expression-ranges-8090/cases.json"
    ))
    .unwrap();
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 25);
    let linter = Linter::with_preset(LintPreset::Incremental)
        .with_additional_rules(vec![RULE.into()])
        .with_rule_severity_overrides(vec![(RULE.into(), Severity::Warning)]);
    for case in cases {
        let source = case["source"].as_str().unwrap();
        let filename = case["filename"].as_str().unwrap();
        let result = linter.lint_sfc(source, filename);
        assert_eq!(whole(&result), case["afterApi"], "{}", case["id"]);
        let formatted = format_results(
            &[result],
            &[(filename.into(), source.into())],
            OutputFormat::Json,
        );
        let packet: Value = serde_json::from_str(formatted.as_str()).unwrap();
        assert_eq!(packet, case["afterCli"], "{}", case["id"]);
    }
}
