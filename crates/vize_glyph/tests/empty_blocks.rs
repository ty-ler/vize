//! Empty top-level SFC blocks stay empty on one line (Prettier keeps
//! `<style lang="less" src="./index.less"></style>` as written).

use serde::Deserialize;
use vize_glyph::{FormatOptions, format_sfc};
use vize_l0::String;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Corpus {
    schema_version: u32,
    #[expect(dead_code, reason = "documents where the cases come from")]
    source: String,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    id: String,
    source: String,
    expected: String,
}

#[test]
fn empty_blocks_stay_empty_and_stable() {
    let corpus: Corpus = serde_json::from_str(include_str!(
        "../../../tests/_fixtures/differential/formatter-empty-blocks/cases.json"
    ))
    .expect("strict empty block corpus");
    assert_eq!(corpus.schema_version, 1);
    assert_eq!(corpus.cases.len(), 5, "every case must execute");
    let options = FormatOptions::default();
    for case in corpus.cases {
        let first = format_sfc(&case.source, &options).expect("valid SFC");
        assert_eq!(
            first.code.as_bytes(),
            case.expected.as_bytes(),
            "{}",
            case.id
        );
        let repeat = format_sfc(&first.code, &options).expect("SFC repeat");
        assert_eq!(repeat.code.as_bytes(), first.code.as_bytes(), "{}", case.id);
        assert!(!repeat.changed, "{}", case.id);
    }
}
