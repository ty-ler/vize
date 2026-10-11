//! The real SVG/JSON registration refusal must retain its operation authority.

use super::{FactRole, InputStamp, Path, SourceRevisionFact, packet, project, reconcile, write};

const IMPORTER: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/native-inferred-assets/Importer.ts"
));
const ICON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/native-inferred-assets/icon.svg"
));
const DATA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/native-inferred-assets/data.json"
));

#[test]
fn readable_non_program_dependencies_retain_original_value_and_exact_importer_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let importer = write(&root, "Importer.ts", IMPORTER);
    let icon = write(&root, "icon.svg", ICON);
    let data = write(&root, "data.json", DATA);
    let frontier = [importer.clone()];
    let mut original = project(&root, &frontier);
    let mut candidate = project(&root, &frontier);
    original
        .register_reachable_dependencies_from(&frontier)
        .unwrap();
    let consumed = reconcile(&mut candidate, &frontier);
    assert!(consumed.qualified);
    assert_eq!(consumed.value, frontier);
    assert_eq!(packet(&candidate), packet(&original));
    for (path, body) in [(&icon, ICON), (&data, DATA)] {
        assert!(candidate.find_by_original(path).is_none());
        assert!(candidate.dependency_edges[&importer].contains(path));
        assert!(!consumed.value.contains(path));
        let fact = consumed
            .stamps
            .iter()
            .find(|stamp| {
                stamp.path() == path
                    && *stamp
                        == &InputStamp::observed_source(path.clone(), body.as_bytes()).with_owner(
                            crate::package_route::stamp::Shared::new(
                                crate::package_route::stamp::FactOwner {
                                    path: importer.clone(),
                                    role: FactRole::DependencyImporter,
                                },
                            ),
                        )
            })
            .unwrap();
        assert!(!fact.is_authored_body_fact());
        let canonical = consumed
            .stamps
            .iter()
            .find(|stamp| {
                stamp.path() == path && stamp.consumed_canonical_file_selection().is_some()
            })
            .unwrap();
        assert!(std::ptr::eq(
            fact.owner().unwrap(),
            canonical.owner().unwrap()
        ));
        let now = fact.current_consumed_fact().unwrap();
        assert_eq!(
            fact.source_revision_fact(&now, &[]),
            SourceRevisionFact::Unchanged
        );
        std::fs::write(path, "changed bytes").unwrap();
        let changed = fact.current_consumed_fact().unwrap();
        assert_eq!(
            fact.source_revision_fact(&changed, &[]),
            SourceRevisionFact::Incompatible
        );
        std::fs::remove_file(path).unwrap();
        let deleted = fact.current_consumed_fact().unwrap();
        assert_eq!(
            fact.source_revision_fact(&deleted, &[path.clone()]),
            SourceRevisionFact::Incompatible
        );
    }
}

#[test]
fn unsupported_utf8_read_failures_keep_original_stub_and_cold_refusal() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let importer = write(&root, "Importer.ts", "import './icon.svg';\nexport {};\n");
    let icon = write(&root, "icon.svg", [0xff, 0xfe]);
    assert_cold_unchanged(&root, &importer, &icon);
}

#[test]
fn malformed_vue_registration_keeps_original_stub_and_cold_refusal() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let importer = write(&root, "Importer.ts", "import './Broken.vue';\nexport {};\n");
    let broken = write(
        &root,
        "Broken.vue",
        "<script>const first = 1;</script><script>const second = 2;</script>",
    );
    assert_cold_unchanged(&root, &importer, &broken);
}

fn assert_cold_unchanged(root: &Path, importer: &Path, dependency: &Path) {
    let frontier = [importer.to_path_buf()];
    let mut original = project(root, &frontier);
    let mut candidate = project(root, &frontier);
    original
        .register_reachable_dependencies_from(&frontier)
        .unwrap();
    let consumed = reconcile(&mut candidate, &frontier);
    assert!(!consumed.qualified);
    assert_eq!(consumed.value, frontier);
    assert!(candidate.find_by_original(dependency).is_none());
    assert_eq!(packet(&candidate), packet(&original));
}
