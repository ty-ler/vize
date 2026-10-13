//! Rule ownership controls minimized from the pinned release real-project matrix.

use serde::Deserialize;
use vize_l0::String;
use vize_patina::rules::vue::{RequireVForKey, ValidVFor};
use vize_patina::{HelpLevel, JsxLang, Linter, RuleRegistry};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    id: String,
    source: String,
    require_key: usize,
    valid_for: usize,
    valid_range: Option<String>,
}

#[test]
fn native_and_component_iteration_keys_have_separate_rule_owners() {
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("fixtures/v-for-key-ownership/cases.json")).unwrap();
    let mut registry = RuleRegistry::new();
    registry.register(Box::new(RequireVForKey));
    registry.register(Box::new(ValidVFor));
    let linter = Linter::with_registry(registry).with_help_level(HelpLevel::None);
    for case in cases {
        let result = linter.lint_template(&case.source, "iteration.vue");
        let require = result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.rule_name == "vue/require-v-for-key")
            .count();
        let valid = result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.rule_name == "vue/valid-v-for")
            .collect::<Vec<_>>();
        assert_eq!(require, case.require_key, "{}: {:?}", case.id, result);
        assert_eq!(valid.len(), case.valid_for, "{}: {:?}", case.id, result);
        assert_eq!(result.error_count, require + valid.len(), "{}", case.id);
        if let Some(expected) = &case.valid_range {
            for diagnostic in valid {
                assert_eq!(
                    &case.source[diagnostic.start as usize..diagnostic.end as usize],
                    expected,
                    "{}",
                    case.id
                );
            }
        }
    }
}

#[test]
fn jsx_mapped_components_still_need_keys() {
    let mut registry = RuleRegistry::new();
    registry.register(Box::new(RequireVForKey));
    let linter = Linter::with_registry(registry);
    let result = linter.lint_jsx(
        "const view = items.map((item) => <Row item={item} />);",
        "iteration.jsx",
        JsxLang::Jsx,
    );
    assert_eq!(result.error_count, 1, "{:?}", result);
}
