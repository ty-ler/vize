//! Original owner callbacks and complete warm/cold source artifacts.
use super::{
    CHILD, Fixture, HOST, IMPORTER, LOCAL, OWNER, PAIR, owners, package, qualified, whole,
};
use crate::corsa_bridge::vue_dependencies_alias::AliasContext;
use vize_carton::FxHashMap;

#[test]
fn deleted_package_importer_retires_positive_negative_owners_and_restore_cold_heals() {
    let host = "<script setup lang='ts'>import A from './A.vue';</script><template><A/></template>";
    let fixture = Fixture::new(host);
    let target = package(&fixture);
    let importer = fixture.write("src/A.vue", IMPORTER);
    let empty = FxHashMap::default();
    let first = fixture.open(host, &empty);
    assert!(qualified(&fixture));
    let bindings = first
        .mirror
        .as_ref()
        .unwrap()
        .current_package_route_bindings();
    assert!(
        bindings
            .iter()
            .any(|binding| binding.importer_path == importer
                && binding.specifier == "missing-owner"
                && binding.route.is_none())
    );
    assert_eq!(owners(&first, &target), vec![importer.clone()]);
    let artifact = first
        .mirror
        .as_ref()
        .unwrap()
        .preferred_materialized_path_for_original(&target)
        .unwrap();
    assert!(!first.route_inputs.is_empty());
    drop(first);
    std::fs::remove_file(&importer).unwrap();
    AliasContext::forget_cached_sources(&fixture.session, &[importer.clone()]);
    let deleted = fixture.open(host, &empty);
    assert!(
        deleted.graph_reused,
        "the actual candidate must perform retirement"
    );
    let mirror = deleted.mirror.as_ref().unwrap();
    assert!(mirror.find_by_original(&importer).is_none());
    assert!(mirror.find_by_original(&target).is_none());
    assert!(
        mirror
            .current_package_route_bindings()
            .iter()
            .all(|binding| binding.importer_path != importer)
    );
    assert!(deleted.package_routes.is_empty());
    assert!(deleted.route_inputs.is_empty());
    assert!(!artifact.exists());
    assert!(deleted.source_catalog.get(&artifact).is_none());
    whole(&fixture, &deleted, host, &empty, &[]);
    // The host still imports the missing module. This is a source/graph law,
    // not an assertion of the native TS2307 diagnostic packet.
    drop(deleted);
    fixture.write("src/A.vue", IMPORTER);
    let restored = fixture.open(host, &empty);
    assert!(
        !restored.graph_reused,
        "a recreated negative probe must rebuild cold"
    );
    assert_eq!(owners(&restored, &target), vec![importer]);
    assert!(artifact.is_file());
    whole(&fixture, &restored, host, &empty, &[]);
}

#[test]
fn retained_importer_removes_binding_none_and_its_complete_input_contribution() {
    let source = "<script setup lang='ts'>import Missing from 'missing-owner'; void Missing;</script><template>before</template>";
    let fixture = Fixture::new(source);
    fixture.write(
        "package.json",
        "{\"name\":\"negative-control\",\"private\":true}\n",
    );
    let empty = FxHashMap::default();
    let first = fixture.open(source, &empty);
    assert!(qualified(&fixture));
    let bindings = first
        .mirror
        .as_ref()
        .unwrap()
        .current_package_route_bindings();
    assert!(
        bindings
            .iter()
            .any(|binding| binding.importer_path == fixture.host
                && binding.specifier == "missing-owner"
                && binding.route.is_none())
    );
    assert!(!first.route_inputs.is_empty());
    drop(first);
    let removed = fixture.open(LOCAL, &empty);
    assert!(removed.graph_reused);
    assert!(
        removed
            .mirror
            .as_ref()
            .unwrap()
            .current_package_route_bindings()
            .is_empty()
    );
    assert!(removed.route_inputs.is_empty());
    assert!(qualified(&fixture));
    whole(&fixture, &removed, LOCAL, &empty, &[]);
}

#[test]
fn actual_shared_root_owners_release_prune_and_reacquire_without_stale_inputs() {
    let fixture = Fixture::new(PAIR);
    let target = package(&fixture);
    let a = fixture.write("src/A.vue", OWNER);
    let b = fixture.write("src/B.vue", OWNER);
    let empty = FxHashMap::default();
    let first = fixture.open(PAIR, &empty);
    assert!(qualified(&fixture));
    assert_eq!(owners(&first, &target), vec![a.clone(), b.clone()]);
    drop(first);
    fixture.write("src/A.vue", LOCAL);
    let one = fixture.open(PAIR, &empty);
    assert!(one.graph_reused);
    assert_eq!(owners(&one, &target), vec![b.clone()]);
    assert!(
        one.mirror
            .as_ref()
            .unwrap()
            .find_by_original(&target)
            .is_some()
    );
    whole(&fixture, &one, PAIR, &empty, &[]);
    drop(one);
    fixture.write("src/B.vue", LOCAL);
    let none = fixture.open(PAIR, &empty);
    assert!(none.graph_reused);
    assert!(owners(&none, &target).is_empty());
    assert!(
        none.mirror
            .as_ref()
            .unwrap()
            .find_by_original(&target)
            .is_none()
    );
    assert!(none.package_routes.is_empty());
    assert!(none.route_inputs.is_empty());
    whole(&fixture, &none, PAIR, &empty, &[]);
    drop(none);
    fixture.write("src/A.vue", OWNER);
    let acquired = fixture.open(PAIR, &empty);
    assert!(acquired.graph_reused);
    assert_eq!(owners(&acquired, &target), vec![a]);
    assert!(
        acquired
            .mirror
            .as_ref()
            .unwrap()
            .find_by_original(&target)
            .is_some()
    );
    whole(&fixture, &acquired, PAIR, &empty, &[]);
}

#[test]
fn newly_reachable_preexisting_overlay_uses_actual_unsaved_body_and_whole_maps() {
    let fixture = Fixture::new(HOST);
    let path = fixture.write("src/Unrelated.vue", "<template>disk</template>\n");
    let unsaved = "<!-- 🦀 -->\r\n<script setup lang='ts'>const text = 'unsaved';</script>\r\n<template>{{ text }}</template>\r\n";
    let overlays = FxHashMap::from_iter([(path.clone(), unsaved)]);
    let first = fixture.open(HOST, &overlays);
    assert!(qualified(&fixture));
    assert!(
        first
            .mirror
            .as_ref()
            .unwrap()
            .find_by_original(&path)
            .is_none()
    );
    drop(first);
    let edited = HOST.replace(
        "const count = 1;",
        "import Other from './Unrelated.vue'; const count = 2; void Other;",
    );
    let reached = fixture.open(&edited, &overlays);
    assert!(reached.graph_reused);
    let mirror = reached.mirror.as_ref().unwrap();
    let file = mirror.find_by_original(&path).unwrap();
    assert_eq!(
        mirror.original_content_for_virtual(&file.virtual_path),
        Some(unsaved)
    );
    assert!(file.content.contains("'unsaved'"));
    assert!(qualified(&fixture));
    whole(&fixture, &reached, &edited, &overlays, &[]);
}

#[test]
fn app_acquires_new_workspace_vue_package_target_before_empty_frontier_exit() {
    let mut fixture = Fixture::new(LOCAL);
    let app = fixture.root.join("src/App.vue");
    std::fs::rename(&fixture.host, &app).unwrap();
    fixture.host = app;
    let target = package(&fixture);
    let importer = fixture.write("src/newWorkspaceWidget.vue", OWNER);
    let empty = FxHashMap::default();
    let first = fixture.open(LOCAL, &empty);
    assert!(qualified(&fixture));
    assert!(first.package_routes.is_empty());
    assert!(first.route_inputs.is_empty());
    assert!(
        first
            .mirror
            .as_ref()
            .unwrap()
            .find_by_original(&importer)
            .is_none()
    );
    assert!(
        first
            .mirror
            .as_ref()
            .unwrap()
            .find_by_original(&target)
            .is_none()
    );
    drop(first);
    let edited = "<script setup lang='ts'>import WorkspaceWidget from './newWorkspaceWidget.vue';</script><template><WorkspaceWidget/></template>";
    let acquired = fixture.open(edited, &empty);
    assert!(acquired.graph_reused);
    assert!(qualified(&fixture));
    let mirror = acquired.mirror.as_ref().unwrap();
    let source = mirror.find_by_original(&importer).unwrap();
    assert_eq!(
        mirror.original_content_for_virtual(&source.virtual_path),
        Some(OWNER)
    );
    let generated = mirror.find_by_original(&target).unwrap();
    assert_eq!(
        mirror.original_content_for_virtual(&generated.virtual_path),
        Some(CHILD)
    );
    let artifact = mirror
        .preferred_materialized_path_for_original(&target)
        .unwrap();
    assert!(
        artifact.is_file(),
        "the new binding must register and materialize its target"
    );
    assert!(mirror.package_route_source_paths().contains(&target));
    assert_eq!(owners(&acquired, &target), vec![importer.clone()]);
    assert!(
        mirror
            .current_package_route_bindings()
            .iter()
            .any(|binding| binding.importer_path == importer
                && binding.specifier == "@scope/ui"
                && binding
                    .route
                    .as_ref()
                    .is_some_and(|route| route.source_paths.contains(&target)))
    );
    assert!(acquired.route_inputs.contains(&target));
    whole(&fixture, &acquired, edited, &empty, &[]);
}
