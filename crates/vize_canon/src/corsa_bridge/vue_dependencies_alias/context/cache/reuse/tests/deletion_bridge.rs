//! The actual exclusive Bridge API preserves only current source ownership.

use std::path::PathBuf;

use vize_carton::FxHashMap;

use super::support::{CHILD, Fixture, HOST};
use crate::corsa_bridge::vue_dependencies_alias::{AliasContext, context::PreparedAliasContext};
use crate::corsa_bridge::vue_document::CorsaProjectEnvironment;
use crate::corsa_bridge::{CorsaBridge, CorsaBridgeConfig};

fn open(
    bridge: &CorsaBridge,
    fixture: &Fixture,
    source: &str,
    overlays: &FxHashMap<PathBuf, &str>,
) -> PreparedAliasContext {
    AliasContext::for_host_cached(
        &fixture.host,
        source,
        overlays,
        fixture.options,
        CorsaProjectEnvironment {
            editor_session: &bridge.editor_session,
            ..fixture.environment()
        },
    )
    .unwrap()
}

fn bridge(fixture: &Fixture) -> CorsaBridge {
    CorsaBridge::with_config(CorsaBridgeConfig {
        working_dir: Some(fixture.root.clone()),
        ..Default::default()
    })
}

#[test]
fn deleted_closed_source_cannot_resurrect_and_unrelated_unsaved_vue_stays_current() {
    let host = HOST.replace(
        "import Child",
        "import Other from './Other.vue'; import Child",
    );
    let fixture = Fixture::new(&host);
    let child = fixture.root.join("src/Child.vue");
    let other = fixture.write("src/Other.vue", "<template>disk</template>");
    let unsaved = "<script setup lang='ts'>const label = 'unsaved 🦀';</script><template>{{ label }}</template>";
    let mut overlays = FxHashMap::from_iter([(child.clone(), CHILD), (other.clone(), unsaved)]);
    let mut bridge = bridge(&fixture);
    let first = open(&bridge, &fixture, &host, &overlays);
    let generated = first
        .mirror
        .as_ref()
        .unwrap()
        .preferred_materialized_path_for_original(&child)
        .unwrap();
    assert!(generated.is_file());
    drop(first);
    std::fs::remove_file(&child).unwrap();
    overlays.remove(&child);
    bridge.mark_deleted_vue_virtual_documents(&[child.clone()]);
    let deleted = open(&bridge, &fixture, &host, &overlays);
    assert!(
        deleted.graph_reused,
        "the original bridge cache must be exercised"
    );
    let mirror = deleted.mirror.as_ref().unwrap();
    assert!(mirror.find_by_original(&child).is_none());
    assert!(!generated.exists());
    assert!(deleted.source_catalog.get(&generated).is_none());
    let file = mirror.find_by_original(&other).unwrap();
    assert_eq!(
        mirror.original_content_for_virtual(&file.virtual_path),
        Some(unsaved)
    );
    fixture.assert_cold_equal(&deleted, &host, &overlays);
    drop(deleted);
    bridge.mark_deleted_vue_virtual_documents(&[child.clone()]);
    let repeated = open(&bridge, &fixture, &host, &overlays);
    assert!(repeated.graph_reused);
    fixture.assert_cold_equal(&repeated, &host, &overlays);
    drop(repeated);
    fixture.write("src/Child.vue", CHILD);
    let restored = open(&bridge, &fixture, &host, &overlays);
    assert!(
        !restored.graph_reused,
        "restored negative probes remain cold authority"
    );
    assert!(
        restored
            .mirror
            .as_ref()
            .unwrap()
            .find_by_original(&child)
            .is_some()
    );
    fixture.assert_cold_equal(&restored, &host, &overlays);
}

#[test]
fn a_current_authoritative_open_buffer_is_valid_after_disk_deletion_then_close_uses_disk() {
    let fixture = Fixture::new(HOST);
    let child = fixture.root.join("src/Child.vue");
    let mut bridge = bridge(&fixture);
    drop(open(&bridge, &fixture, HOST, &FxHashMap::default()));
    std::fs::remove_file(&child).unwrap();
    bridge.mark_deleted_vue_virtual_documents(&[child.clone()]);
    let unsaved = CHILD.replace("'before'", "'current'");
    let overlays = FxHashMap::from_iter([(child.clone(), unsaved.as_str())]);
    let current = open(&bridge, &fixture, HOST, &overlays);
    let mirror = current.mirror.as_ref().unwrap();
    let file = mirror.find_by_original(&child).unwrap();
    assert_eq!(
        mirror.original_content_for_virtual(&file.virtual_path),
        Some(unsaved.as_str())
    );
    fixture.assert_cold_equal(&current, HOST, &overlays);
    drop(current);
    fixture.write("src/Child.vue", CHILD);
    let closed = open(&bridge, &fixture, HOST, &FxHashMap::default());
    assert!(
        !closed.graph_reused,
        "closing an existing overlay must use the original cold path"
    );
    let mirror = closed.mirror.as_ref().unwrap();
    let file = mirror.find_by_original(&child).unwrap();
    assert_eq!(
        mirror.original_content_for_virtual(&file.virtual_path),
        Some(CHILD)
    );
    fixture.assert_cold_equal(&closed, HOST, &FxHashMap::default());
}
