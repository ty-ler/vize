use super::{ParserWork, collect_specifiers, package_specifiers_from_frontier};
use crate::batch::ImportRewriter;
use crate::batch::virtual_project::{VirtualProject, dependency_scan::ParsedDependencySources};
use oxc_span::SourceType;
use std::path::Path;
use vize_carton::{FxHashSet, String};

#[test]
fn exact_packets_preserve_complete_first_seen_order_across_occurrence_modes() {
    let rewriter = ImportRewriter::new();
    let path = Path::new("/current/Module.ts");
    let sources = [
        "import 'first'; const x = require('first'); export * from 'second'; import 'first'; import('third');",
        "type T = import('types', { with: { 'resolution-mode': 'require' } }); import 'types'; declare module 'ambient' {}",
        "import data from 'data' with { type: 'json' }; export { data } from 'data';",
        "import Alias = require('aliased'); export { x } from 'named'; import type { T } from 'typed' with { 'resolution-mode': 'require' };",
        r#"import 'ünicode'; import("\u0066irst"); import 'first';"#,
        "const node = <Widget value={import('child')} />; export {};",
        "import x from 'broken'const y = ; import('later');",
        "export {};",
    ];
    for syntax in [
        SourceType::ts(),
        SourceType::tsx(),
        SourceType::js(),
        SourceType::jsx(),
    ] {
        for source in sources {
            let mut parsed = ParsedDependencySources::default();
            let original = rewriter.collect_all_specifiers(source, syntax);
            let whole_occurrences = parsed.occurrences(&rewriter, path, source, syntax);
            let retained = parsed
                .current_occurrences(path, source, syntax)
                .unwrap()
                .as_ptr();
            let mut work = ParserWork::default();
            for _ in 0..2 {
                assert_eq!(
                    collect_specifiers(&rewriter, path, source, syntax, Some(&parsed), &mut work),
                    original
                );
                assert_eq!(
                    parsed.current_occurrences(path, source, syntax).unwrap(),
                    whole_occurrences
                );
                assert_eq!(
                    parsed
                        .current_occurrences(path, source, syntax)
                        .unwrap()
                        .as_ptr(),
                    retained
                );
            }
            assert_eq!(
                work,
                ParserWork {
                    original_calls: 2,
                    actual_calls: 0,
                    exact_hits: 2
                }
            );
        }
    }
    let expected: Vec<String> = ["first", "second", "third"]
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(
        rewriter.collect_all_specifiers(sources[0], SourceType::ts()),
        expected
    );
}

#[test]
fn changed_complete_bytes_syntax_and_path_use_the_original_parser_without_retention() {
    let rewriter = ImportRewriter::new();
    let path = Path::new("/current/Module.ts");
    let other = Path::new("/current/Other.ts");
    let before = "import 'first'; export {};";
    let after = "import 'other'; export {};";
    assert_eq!(before.len(), after.len());
    let mut parsed = ParsedDependencySources::default();
    let original_packet = parsed.occurrences(&rewriter, path, before, SourceType::ts());
    let retained = parsed
        .current_occurrences(path, before, SourceType::ts())
        .unwrap()
        .as_ptr();
    let mut work = ParserWork::default();
    for (path, source, syntax, cache) in [
        (path, after, SourceType::ts(), Some(&parsed)),
        (path, before, SourceType::tsx(), Some(&parsed)),
        (other, before, SourceType::ts(), Some(&parsed)),
        (path, before, SourceType::ts(), None),
    ] {
        assert_eq!(
            collect_specifiers(&rewriter, path, source, syntax, cache, &mut work),
            rewriter.collect_all_specifiers(source, syntax)
        );
    }
    assert_eq!(
        work,
        ParserWork {
            original_calls: 4,
            actual_calls: 4,
            exact_hits: 0
        }
    );
    assert_eq!(
        parsed
            .current_occurrences(path, before, SourceType::ts())
            .unwrap(),
        original_packet
    );
    assert_eq!(
        parsed
            .current_occurrences(path, before, SourceType::ts())
            .unwrap()
            .as_ptr(),
        retained
    );
    assert!(
        parsed
            .current_occurrences(path, after, SourceType::ts())
            .is_none()
    );
    assert!(
        parsed
            .current_occurrences(path, before, SourceType::tsx())
            .is_none()
    );
    assert!(
        parsed
            .current_occurrences(other, before, SourceType::ts())
            .is_none()
    );
}

#[test]
fn mixed_frontier_retains_sorted_package_vector_and_scanned_source_identity() {
    let root = tempfile::tempdir().unwrap();
    let mut project = VirtualProject::new(root.path()).unwrap();
    let sources = [
        (
            root.path().join("a.ts"),
            "import 'zeta'; import './local'; const z = require('zeta'); import '/absolute';",
        ),
        (
            root.path().join("b.ts"),
            "export * from 'alpha'; import '#private';",
        ),
    ];
    let mut parsed = ParsedDependencySources::default();
    for (index, (path, source)) in sources.iter().enumerate() {
        project.register_path_with_content(path, source).unwrap();
        let file = project.find_by_original(path).unwrap();
        if index == 0 {
            parsed.occurrences(
                &ImportRewriter::new(),
                &file.virtual_path,
                &file.content,
                SourceType::ts(),
            );
        }
    }
    let mut old_scanned = FxHashSet::default();
    let mut new_scanned = FxHashSet::default();
    let original = package_specifiers_from_frontier(&project, &mut old_scanned, None);
    let current = package_specifiers_from_frontier(&project, &mut new_scanned, Some(&parsed));
    let expected: Vec<String> = ["#private", "alpha", "zeta"]
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(original, expected);
    assert_eq!(current, original);
    assert_eq!(new_scanned, old_scanned);
    assert!(package_specifiers_from_frontier(&project, &mut new_scanned, Some(&parsed)).is_empty());
    assert_eq!(new_scanned, old_scanned);
}
