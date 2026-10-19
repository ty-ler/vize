use crate::rules::script::ScriptLinter;

use super::NoDeprecatedVueConfigKeycodes;

fn findings(source: &str) -> Vec<&str> {
    let mut linter = ScriptLinter::new();
    linter.add_rule(Box::new(NoDeprecatedVueConfigKeycodes));
    linter
        .lint(source, 0)
        .diagnostics
        .iter()
        .map(|diagnostic| {
            source
                .get(diagnostic.start as usize..diagnostic.end as usize)
                .unwrap_or_default()
        })
        .collect()
}

#[test]
fn reads_and_writes_of_key_codes_are_reported() {
    let source = "Vue.config.keyCodes = { f1: 112 }\nconst codes = Vue.config.keyCodes\nVue.config.keyCodes.f2 = 113\n";
    assert_eq!(
        findings(source),
        [
            "Vue.config.keyCodes",
            "Vue.config.keyCodes",
            "Vue.config.keyCodes"
        ]
    );
}

#[test]
fn other_config_and_objects_are_allowed() {
    let source =
        "Vue.config.productionTip = false\napp.config.keyCodes = {}\nconfig.keyCodes = {}\n";
    assert!(findings(source).is_empty());
}
