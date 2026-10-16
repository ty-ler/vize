//! #9217: positive local wrapper ownership, with unknown receivers preserved.

use vize_patina::{HelpLevel, LintPreset, Linter};

const RULE: &str = "script/no-deprecated-events-api";

fn warnings(source: &str) -> Vec<(u32, u32)> {
    let source = format!("<script>{source}</script>");
    Linter::with_preset(LintPreset::Essential)
        .with_enabled_rules(Some(vec![RULE.into()]))
        .with_help_level(HelpLevel::Full)
        .lint_sfc(&source, "Component.vue")
        .diagnostics
        .into_iter()
        .filter(|diagnostic| diagnostic.rule_name == RULE)
        .map(|diagnostic| (diagnostic.start - 8, diagnostic.end - 8))
        .collect()
}

#[test]
fn exact_gogocode_source_keeps_only_the_unresolved_sibling_receiver() {
    // Gogocode 6b94d4d05ee4facc935fe2c3e4965655913afd6e, events-api/B.vue.
    // SHA256 136f82332bfa8b7795c5802015fc64859d3fbb794ce3720a73fe7093ecede165.
    // Bytes are copied from the complete, unchanged #9217 provenance packet.
    let source = include_str!("fixtures/authored-event-wrappers/gogocode-B.vue.txt");
    for preset in [LintPreset::Essential, LintPreset::HappyPath] {
        let diagnostics: Vec<_> = Linter::with_preset(preset)
            .with_enabled_rules(Some(vec![RULE.into()]))
            .lint_sfc(source, "B.vue")
            .diagnostics
            .into_iter()
            .filter(|diagnostic| diagnostic.rule_name == RULE)
            .collect();
        assert_eq!(diagnostics.len(), 1, "{preset:?}");
        let start = source.rfind("$off").unwrap() as u32;
        assert_eq!(diagnostics[0].start, start);
        assert_eq!(diagnostics[0].end, start + 4);
    }
}

#[test]
fn authored_callable_properties_are_local_apis_regardless_of_names() {
    for source in [
        "let bus = {}; const methods = {$on: (...args) => emitter.on(...args)}; Object.assign(bus, methods); bus.$on('x', h)",
        "const bus = {}; const methods = {$off(...args) { emitter.off(...args) }}; Object.assign(bus, methods); bus.$off('x')",
        "function mounted() { let bus = {}; const methods = {$once: function(...args) { emitter.once(...args) }}; Object.assign(bus, methods); bus.$once('x', h) }",
        "const bus = {}; const methods = {$on: () => {}, $off: () => {}}; Object.assign(bus, methods); bus.$on('x'); bus.$off('x')",
    ] {
        assert!(warnings(source).is_empty(), "{source}");
    }
}

#[test]
fn lexical_symbols_separate_sibling_and_shadowed_receivers() {
    let source = "function mounted() { let bus = {}; const methods = {$on: () => {}}; Object.assign(bus, methods); bus.$on('owned') } function sibling() { bus.$on('unknown') }";
    assert_eq!(warnings(source).len(), 1);
    let source = "let bus = {}; const methods = {$on: () => {}}; Object.assign(bus, methods); bus.$on('owned'); function inner(bus) { bus.$on('unknown') }";
    assert_eq!(warnings(source).len(), 1);
}

#[test]
fn uncertain_transfers_and_mutations_retain_historical_warnings() {
    let head = "let bus = {}; const methods = {$on: () => {}}; ";
    for tail in [
        "const Object = other; Object.assign(bus, methods); bus.$on('x')",
        "Object.assign = custom; Object.assign(bus, methods); bus.$on('x')",
        "Object.assign(bus, methods, other); bus.$on('x')",
        "if (condition) Object.assign(bus, methods); bus.$on('x')",
        "Object.assign(bus, methods); bus = unknown; bus.$on('x')",
        "Object.assign(bus, methods); bus.$on = unknown; bus.$on('x')",
        "Object.assign(bus, methods); mutate(bus); bus.$on('x')",
        "Object.assign(bus, methods); const alias = bus; bus.$on('x')",
        "Object.assign(bus, methods); mutate(methods); bus.$on('x')",
        "Object.assign(bus, methods); methods.$on = unknown; bus.$on('x')",
        "bus.$on('before'); Object.assign(bus, methods)",
        "Object.assign(bus, methods); (() => bus.$on('nested'))()",
        "Object.assign(bus, methods); eval('bus.$on = other'); bus.$on('x')",
        "Object.assign(bus, methods); (eval)('bus.$on = other'); bus.$on('x')",
        "Object.assign(bus, methods); \\u0065val('bus.$on = other'); bus.$on('x')",
        "Object.assign(bus, methods); bus.$on('x', bus)",
    ] {
        let source = format!("{head}{tail}");
        assert_eq!(warnings(&source).len(), 1, "{source}");
    }
}

#[test]
fn unknown_property_owners_cannot_silence_the_rule() {
    for initializer in [
        "{$on: this.$on}",
        "{$on: factory()}",
        "{get $on() { return handler }}",
        "{$on: () => {}, ...other}",
        "{[name]: () => {}}",
        "{$on: () => {}, $on: other}",
        "{$on() { this.$on = other }}",
        "{$on() { super.changeOwner() }}",
        "{__proto__: null, $on: () => {}}",
        "{$on: () => { mutate(bus) }}",
    ] {
        let source = format!(
            "let bus = {{}}; const methods = {initializer}; Object.assign(bus, methods); bus.$on('x')"
        );
        assert_eq!(warnings(&source).len(), 1, "{source}");
    }
}

#[test]
fn independent_component_calls_still_report_inside_foreign_wrappers() {
    let source = "let bus = {}; const methods = {$on: () => vm.$on('x')}; Object.assign(bus, methods); bus.$on('owned')";
    let start = source.find("$on('x')").unwrap() as u32;
    assert_eq!(warnings(source), vec![(start, start + 3)]);
}

// These two intentionally failing boundary regressions explain why #9276 was
// rejected and closed. They must pass before this candidate can be revived.
#[test]
fn global_assign_alias_does_not_prove_foreign_method_ownership() {
    let source = include_str!(
        "../../../tests/_fixtures/differential/lint/legacy-instance-apis-9217/rejected-wrapper-proof/global-assign-alias.ts.txt"
    );
    assert_eq!(warnings(source).len(), 1);
}

#[test]
fn inherited_setters_do_not_prove_foreign_method_ownership() {
    let source = include_str!(
        "../../../tests/_fixtures/differential/lint/legacy-instance-apis-9217/rejected-wrapper-proof/inherited-setter.ts.txt"
    );
    assert_eq!(warnings(source).len(), 1);
}
