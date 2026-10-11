use super::{
    DependencyConsumption, FactOwner, FactRole, InputStamp, Path, Shared, VirtualProject, packet,
};
use vize_carton::FxHashMap;

const HOST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/editor-deleted-overlay/Host.vue"
));
const CHILD: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/editor-deleted-overlay/Child.vue"
));
const UNRELATED: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/editor-deleted-overlay/Unrelated.vue"
));
const CONFIG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/typechecker/editor-deleted-overlay/tsconfig.json"
));

fn project(root: &Path, host: &Path) -> VirtualProject {
    let mut project = VirtualProject::new(root).unwrap();
    project.set_tsconfig_path(Some(root.join("tsconfig.json")));
    project.register_path(host).unwrap();
    project
}

#[test]
fn deleted_reachable_buffer_keeps_whole_original_values_and_actual_negative_disk_facts() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let host = root.join("Host.vue");
    let child = root.join("Child.vue");
    let unrelated = root.join("Unrelated.vue");
    std::fs::write(root.join("tsconfig.json"), CONFIG).unwrap();
    std::fs::write(&host, HOST).unwrap();
    std::fs::write(&child, CHILD).unwrap();
    std::fs::remove_file(&child).unwrap();
    let overlays = FxHashMap::from_iter([(child.clone(), CHILD), (unrelated.clone(), UNRELATED)]);
    let mut expected = project(&root, &host);
    expected.register_path_with_content(&child, CHILD).unwrap();
    expected
        .register_reachable_dependencies_with_overlays(&overlays)
        .unwrap();
    let mut candidate = project(&root, &host);
    let aliases = candidate.dependency_alias_map_observed();
    let consumed = candidate
        .register_reachable_dependencies_consumed_inner(
            None,
            &overlays,
            &[],
            None,
            DependencyConsumption {
                aliases: Some(aliases),
                resolver: None,
                registered_roots: None,
            },
        )
        .unwrap();
    assert!(consumed.qualified);
    assert_eq!(packet(&candidate), packet(&expected));
    assert!(candidate.find_by_original(&child).is_some());
    assert!(candidate.find_by_original(&unrelated).is_none());
    let owner = Shared::new(FactOwner {
        path: host,
        role: FactRole::DependencyImporter,
    });
    for stamp in [
        InputStamp::observed_is_file(child.clone(), false),
        InputStamp::observed_try_exists(child.clone(), Ok(false)),
        InputStamp::observed_canonical_file(child.clone(), child.clone(), false),
    ] {
        assert!(consumed.stamps.contains(&stamp.with_owner(owner.clone())));
    }
    assert!(
        consumed
            .stamps
            .iter()
            .any(|stamp| stamp.has_registered_body(&child, CHILD.as_bytes()))
    );
    assert!(
        !consumed
            .stamps
            .iter()
            .any(|stamp| stamp.has_registered_body(&unrelated, UNRELATED.as_bytes()))
    );
}

#[test]
fn supplied_directory_never_becomes_a_source_file() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let host = root.join("Host.vue");
    let child = root.join("Child.vue");
    std::fs::write(root.join("tsconfig.json"), CONFIG).unwrap();
    std::fs::write(&host, HOST).unwrap();
    std::fs::create_dir(&child).unwrap();
    let overlays = FxHashMap::from_iter([(child.clone(), CHILD)]);
    let mut candidate = project(&root, &host);
    candidate
        .register_reachable_dependencies_with_overlays(&overlays)
        .unwrap();
    assert!(candidate.find_by_original(&child).is_none());
    assert_eq!(candidate.registered_original_paths_sorted(), [host]);
}

#[test]
fn runtime_buffer_does_not_overtake_the_original_type_source_precedence() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let typed = root.join("Child.ts");
    let runtime = root.join("Child.js");
    std::fs::write(&typed, "export const typed = 1;").unwrap();
    let overlays = FxHashMap::from_iter([(runtime.clone(), "export const runtime = 2;")]);
    let result = super::super::resolution::resolve_dependency_with_overlays_consumed(
        "./Child.js",
        &root,
        &root,
        &[],
        &overlays,
        true,
    );
    assert_eq!(result.value.0, Some(typed.clone()));
    assert!(
        result
            .stamps
            .contains(&InputStamp::observed_is_file(typed, true))
    );
    assert!(!result.stamps.iter().any(|stamp| stamp.path() == runtime));
}

#[test]
fn an_exact_alias_can_reach_only_its_actual_supplied_missing_target() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let host = root.join("Host.vue");
    let child = root.join("Child.vue");
    std::fs::write(
        root.join("tsconfig.json"),
        "{\"compilerOptions\":{\"paths\":{\"@child\":[\"Child.vue\"]}}}",
    )
    .unwrap();
    std::fs::write(&host, HOST.replace("./Child.vue", "@child")).unwrap();
    let mut candidate = project(&root, &host);
    let overlays = FxHashMap::from_iter([(child.clone(), CHILD)]);
    candidate
        .register_reachable_dependencies_with_overlays(&overlays)
        .unwrap();
    let file = candidate.find_by_original(&child).unwrap();
    assert_eq!(
        candidate.original_content_for_virtual(&file.virtual_path),
        Some(CHILD)
    );
    assert_eq!(candidate.registered_original_paths_sorted(), [child, host]);
}
