use super::DiagnosticService;
use crate::server::ServerState;
use tower_lsp::lsp_types::{DiagnosticSeverity, NumberOrString, Url};

#[test]
fn configured_globals_reach_the_shared_editor_linter() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("vize.config.json"),
        include_str!(
            "../../../../vize_patina/tests/fixtures/global-component-registration/vize.config.json"
        ),
    )
    .unwrap();
    let state = ServerState::new();
    state.load_lsp_config(root.path());
    let uri = Url::from_file_path(root.path().join("Card.vue")).unwrap();
    state.documents.open(
        uri.clone(),
        "<template><MyButton /><my-button /><MissingWidget /></template>".into(),
        1,
        "vue".into(),
    );
    let diagnostics = DiagnosticService::collect_lint_only(&state, &uri);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
        diagnostics[0].code,
        Some(NumberOrString::String(
            "vue/require-component-registration".into()
        ))
    );
    assert_eq!(diagnostics[0].severity, Some(DiagnosticSeverity::ERROR));
    assert_eq!(diagnostics[0].range.start.character, 36);
}

#[test]
fn process_fallback_borrows_explicit_compiler_policy_and_keeps_unknown_neighbors() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("vize.config.json"),
        r#"{"compiler":{"customElements":["my-owned"]},
            "linter":{"preset":"incremental","rules":{"vue/require-component-registration":"warn"},
            "ruleOptions":{"vue/require-component-registration":{"globals":["RouterLink"]}}}}"#,
    )
    .unwrap();
    let state = ServerState::new();
    state.load_lsp_config(root.path());
    let uri = Url::from_file_path(root.path().join("Policy.vue")).unwrap();
    state.documents.open(
        uri.clone(),
        "<template>界😀<my-owned/><RouterLink/><my-neighbor/></template>\r\n".into(),
        1,
        "vue".into(),
    );
    let diagnostics = DiagnosticService::collect_lint_only(&state, &uri);
    assert_eq!(
        serde_json::to_value(diagnostics).unwrap(),
        serde_json::json!([{
            "range":{"start":{"line":0,"character":38},"end":{"line":0,"character":49}},
            "severity":2,"code":"vue/require-component-registration",
            "codeDescription":{"href":"https://eslint.vuejs.org/rules/require-component-registration.html"},
            "source":"vize/lint",
            "message":"Component is used but not explicitly imported\n\nHelp: Import the component in <script setup> or register it in components option"
        }])
    );
}
