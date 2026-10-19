use crate::linter::Linter;

const RULE: &str = "script/no-deprecated-model-definition";

fn findings(source: &str) -> Vec<&str> {
    let linter = Linter::new().with_enabled_rules(Some(vec![RULE.into()]));
    let result = linter.lint_sfc(source, "Test.vue");
    result
        .diagnostics
        .iter()
        .map(|diagnostic| {
            assert_eq!(
                diagnostic.message.as_str(),
                "`model` definition is deprecated."
            );
            source
                .get(diagnostic.start as usize..diagnostic.end as usize)
                .unwrap_or_default()
        })
        .collect()
}

#[test]
fn model_option_objects_are_reported() {
    let source = "<script>\nexport default {\n  model: { prop: 'checked', event: 'change' },\n  props: { checked: Boolean },\n}\n</script>\n";
    assert_eq!(
        findings(source),
        ["model: { prop: 'checked', event: 'change' }"]
    );
    let defined = "<script lang=\"ts\">\nexport default defineComponent({ 'model': { prop: 'value' } })\n</script>\n";
    assert_eq!(findings(defined), ["'model': { prop: 'value' }"]);
}

#[test]
fn other_objects_and_shapes_are_allowed() {
    let source = "<script>\nconst form = { model: { prop: 'x' } }\nexport default {\n  props: { modelValue: Boolean },\n  emits: ['update:modelValue'],\n  data() { return { model: {} } },\n}\n</script>\n";
    assert!(findings(source).is_empty());
    let setup = "<script setup>\nconst state = { model: { prop: 'x' } }\n</script>\n";
    assert!(findings(setup).is_empty());
}
