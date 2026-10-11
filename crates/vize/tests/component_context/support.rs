use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub const RULE: &str = "vue/require-component-registration";
pub const CASES: &str = include_str!(
    "../../../../tests/_fixtures/differential/lint/component-registration-context-8142/cases.json"
);

pub fn cases() -> Vec<Value> {
    let corpus: Value = serde_json::from_str(CASES).unwrap();
    let cases = corpus["cases"].as_array().unwrap().clone();
    assert_eq!(cases.len(), 30);
    for case in &cases {
        let source = case["source"].as_str().unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(source.as_bytes())),
            case["sourceSha256"].as_str().unwrap()
        );
    }
    cases
}

pub fn config(case: &Value) -> Value {
    json!({
        "compiler": case["compiler"],
        "linter": {
            "preset": "incremental", "rules": {RULE: "warn"},
            "ruleOptions": {RULE: case["nativeOptions"]}
        },
        "languageServer": {"typecheck": false, "editor": false, "lint": true}
    })
}

pub fn write(root: &Path, filename: &str, source: &str) {
    fs::create_dir_all(root).unwrap();
    fs::write(root.join(filename), source).unwrap();
}

pub fn persist(name: &str, evidence: &Value) {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/differential/component-registration-context-8142");
    fs::create_dir_all(&directory).unwrap();
    fs::write(
        directory.join(name),
        serde_json::to_vec_pretty(evidence).unwrap(),
    )
    .unwrap();
}

pub fn cli_packet(case: &Value, filename: &str) -> Value {
    let source = case["source"].as_str().unwrap();
    let expected = &case["authoredExpectedPacket"];
    let messages = expected["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|diagnostic| {
            let start = position(source, diagnostic["start"].as_u64().unwrap(), false);
            let end = position(source, diagnostic["end"].as_u64().unwrap(), false);
            json!({
                "ruleId": RULE, "ruleDocsPath": "docs/content/rules/vue.md", "severity": 1,
                "message": format!("[vize:{RULE}] {}", diagnostic["message"].as_str().unwrap()),
                "line": start.0 + 1, "column": start.1 + 1,
                "endLine": end.0 + 1, "endColumn": end.1 + 1,
                "help": diagnostic["help"]
            })
        })
        .collect::<Vec<_>>();
    json!([{"file": filename, "messages": messages,
        "errorCount": expected["error_count"], "warningCount": expected["warning_count"]}])
}

#[cfg(feature = "maestro")]
pub fn lsp_packet(case: &Value, uri: &str, version: i32) -> Value {
    let source = case["source"].as_str().unwrap();
    let diagnostics = case["authoredExpectedPacket"]["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|diagnostic| {
            let start = position(source, diagnostic["start"].as_u64().unwrap(), true);
            let end = position(source, diagnostic["end"].as_u64().unwrap(), true);
            json!({
                "range": {"start": {"line": start.0, "character": start.1},
                    "end": {"line": end.0, "character": end.1}},
                "severity": 2, "code": RULE,
                "codeDescription": {"href": "https://eslint.vuejs.org/rules/require-component-registration.html"},
                "source": "vize/lint",
                "message": format!("{}\n\nHelp: {}", diagnostic["message"].as_str().unwrap(),
                    diagnostic["help"].as_str().unwrap())
            })
        })
        .collect::<Vec<_>>();
    json!({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics",
        "params": {"uri": uri, "version": version, "diagnostics": diagnostics}})
}

fn position(source: &str, byte: u64, utf16: bool) -> (usize, usize) {
    let prefix = source.get(..usize::try_from(byte).unwrap()).unwrap();
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count();
    let tail = prefix.rsplit('\n').next().unwrap();
    let column = if utf16 {
        tail.encode_utf16().count()
    } else {
        tail.chars().count()
    };
    (line, column)
}
