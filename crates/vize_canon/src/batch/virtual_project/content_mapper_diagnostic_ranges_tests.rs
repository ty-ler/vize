use super::{mapped_diagnostic_ranges, template_diagnostic_directives};
use crate::virtual_ts::{VizeMapping, VizeSubSpan};
use vize_atelier_sfc::{SfcParseOptions, parse_sfc};
use vize_carton::cstr;

#[test]
fn ignore_and_skip_keep_complete_literal_projection_after_navigation_trims_it() {
    for policy in ["ignore", "skip"] {
        for value in ["bad", "", "😀日本"] {
            for newline in ["\n", "\r\n"] {
                let source = cstr!(
                    "<template>{newline}<!-- @vue-{policy} -->{newline}<Comp id=\"{value}\" />{newline}</template>"
                );
                let descriptor = parse_sfc(&source, SfcParseOptions::default()).unwrap();
                let value_start = source.find("id=\"").unwrap() + "id=\"".len();
                let generated = cstr!("\"{value}\"");
                // This is the native per-prop initializer projection. Its
                // navigation form may retain only the unquoted interior.
                let mappings = [VizeMapping {
                    gen_range: 0..generated.len(),
                    src_range: value_start..value_start + value.len(),
                    sub_spans: Vec::new(),
                }];
                let navigation = [super::ContentMapperSpan([
                    1,
                    value.len(),
                    value_start,
                    value.len(),
                    0,
                    0,
                ])];
                let directives = template_diagnostic_directives(
                    descriptor.template.as_ref(),
                    &navigation,
                    &mappings,
                )
                .unwrap();
                let token_text = cstr!("@vue-{policy}");
                let token = source.find(token_text.as_str()).unwrap();
                assert_eq!(
                    serde_json::to_value(directives).unwrap(),
                    serde_json::json!({
                        "directives":[[token, policy.len() + "@vue-".len(), 0, generated.len(), 0, 0]],
                        "unusedExpectDirectiveDiagnostics":[]
                    })
                );
            }
        }
    }
}

#[test]
fn diagnostic_leaves_never_expand_to_an_enclosing_parent_or_intervening_child() {
    let mappings = [
        VizeMapping {
            gen_range: 0..100,
            src_range: 10..50,
            sub_spans: vec![
                VizeSubSpan {
                    gen_range: 1..5,
                    src_range: 11..13,
                },
                VizeSubSpan {
                    gen_range: 70..75,
                    src_range: 20..23,
                },
            ],
        },
        VizeMapping {
            gen_range: 30..35,
            src_range: 60..65,
            sub_spans: Vec::new(),
        },
    ];
    assert_eq!(
        mapped_diagnostic_ranges(&mappings, &[10..50]),
        [1..5, 70..75]
    );
    assert_eq!(
        mapped_diagnostic_ranges(&mappings, &[10..66]),
        [1..5, 30..35, 70..75]
    );
    assert_eq!(mapped_diagnostic_ranges(&mappings, &[50..60]), []);
}

#[test]
fn expect_keeps_its_existing_single_interval_and_orphan_policy() {
    for orphan in [false, true] {
        let source = if orphan {
            "<template><Comp /><!-- @vue-expect-error --></template>"
        } else {
            "<template><!-- @vue-expect-error --><Comp /></template>"
        };
        let descriptor = parse_sfc(source, SfcParseOptions::default()).unwrap();
        let owner = source.find("Comp").unwrap();
        let mappings = [VizeMapping {
            gen_range: 0..100,
            src_range: owner..owner + 4,
            sub_spans: Vec::new(),
        }];
        let navigation = [super::ContentMapperSpan([10, 4, owner, 4, 0, 0])];
        let directives =
            template_diagnostic_directives(descriptor.template.as_ref(), &navigation, &mappings)
                .unwrap();
        let token = source.find("@vue-expect-error").unwrap();
        let (start, end) = if orphan { (0, 0) } else { (10, 14) };
        assert_eq!(
            serde_json::to_value(directives).unwrap(),
            serde_json::json!({
                "directives":[[token, 17, start, end, 1, 0]],
                "unusedExpectDirectiveDiagnostics":[{"code":4,"messageText":"Unused '@vue-expect-error' directive"}]
            })
        );
    }
}
