use super::{ImportRewriter, ParsedDependencySources, Path, SourceType};

#[test]
fn complete_projection_and_source_type_own_each_ordered_occurrence_packet() {
    let rewriter = ImportRewriter::new();
    let path = Path::new("/current/Projection.vue.ts");
    let sources = [
        "import './a'; import './a'; export * from './b'; const x = require('./a');",
        "const x = import('#private'); type T = import('types', { with: { 'resolution-mode': 'require' } });",
        "import data from 'data' with { type: 'json' }; export { data } from 'data';",
        "const node = <Widget value={import('./child')} />; export {};",
        "import x from './broken'const y = ; import('./later');",
        "export {};",
    ];
    for source_type in [SourceType::ts(), SourceType::tsx()] {
        let mut parsed = ParsedDependencySources::default();
        for source in sources {
            let expected = rewriter.collect_all_specifier_occurrences(source, source_type);
            for _ in 0..3 {
                assert_eq!(
                    parsed.occurrences(&rewriter, path, source, source_type),
                    expected,
                );
            }
        }
        assert_eq!(parsed.parses, sources.len());
        assert_eq!(parsed.hits, sources.len() * 2);
    }
}

#[test]
fn equal_length_edits_and_changed_generated_syntax_reparse_the_actual_source() {
    let rewriter = ImportRewriter::new();
    let path = Path::new("/current/Projection.vue.ts");
    let before = "import './first'; export {};";
    let after = "import './other'; export {};";
    assert_eq!(before.len(), after.len());
    let mut parsed = ParsedDependencySources::default();
    for (source, syntax) in [
        (before, SourceType::ts()),
        (before, SourceType::ts()),
        (after, SourceType::ts()),
        (after, SourceType::tsx()),
        (after, SourceType::tsx()),
        (before, SourceType::ts()),
    ] {
        assert_eq!(
            parsed.occurrences(&rewriter, path, source, syntax),
            rewriter.collect_all_specifier_occurrences(source, syntax),
        );
    }
    assert_eq!(parsed.parses, 4);
    assert_eq!(parsed.hits, 2);
    // The authored SFC can remain equal while its generated module changes.
    let authored = "<script setup lang='ts'>import './first';</script><template/>";
    let projection = "import './first'; import './generated'; export {};";
    assert_eq!(
        parsed.occurrences(&rewriter, path, projection, SourceType::ts()),
        rewriter.collect_all_specifier_occurrences(projection, SourceType::ts()),
    );
    assert!(!authored.contains("./generated"));
    assert_eq!(parsed.parses, 5);
}

mod borrowed;
mod walk;
