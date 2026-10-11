mod canonical_deleted_probe;
mod deleted_probe_replacement;
mod shadow_lifetime;
mod witness;

use super::{Consumed, FactOwner, FactRole, InputStamp, NativeFacts};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

fn fact(path: &Path, body: &[u8], owner: &Path, role: FactRole) -> InputStamp {
    InputStamp::observed_source(path.to_path_buf(), body).with_owner(Arc::new(FactOwner {
        path: owner.to_path_buf(),
        role,
    }))
}

#[test]
fn repeated_equal_reads_coalesce_but_changed_values_and_owners_all_remain() {
    let path = Path::new("/project/tsconfig.json");
    let a = fact(path, b"A", path, FactRole::Configuration);
    let b = fact(path, b"B", path, FactRole::Configuration);
    let other_owner = fact(
        path,
        b"A",
        Path::new("/project/other.vue"),
        FactRole::LocalImporter,
    );
    let mut facts = NativeFacts::new(true);
    for stamp in [&a, &a, &b, &other_owner, &b] {
        facts.insert(stamp.clone());
    }
    assert_eq!(facts.finish(()).stamps, vec![a, b, other_owner]);
}

#[test]
fn callback_completion_keeps_noncontributions_and_visited_target_owner() {
    let a = Path::new("/project/A.vue");
    let target = Path::new("/project/T.vue");
    let old_a = fact(target, b"dependency", a, FactRole::LocalImporter);
    let old_target = fact(target, b"own dependency", target, FactRole::LocalImporter);
    let target_body = fact(target, b"body", target, FactRole::AuthoredSource);
    let config = fact(
        Path::new("/project/tsconfig.json"),
        b"{}",
        Path::new("/project"),
        FactRole::Configuration,
    );
    let mut facts = NativeFacts::new(true);
    facts.retain_previous(
        &[
            old_a.clone(),
            old_target.clone(),
            target_body.clone(),
            config.clone(),
        ],
        &[a.to_path_buf()],
        &[],
        &[],
    );
    assert_eq!(
        facts.finish(()).stamps,
        vec![old_a, old_target, target_body, config]
    );
}

#[test]
fn replacing_source_bytes_does_not_release_its_unfinished_importer_facts() {
    let path = Path::new("/project/A.vue");
    let body = fact(path, b"old", path, FactRole::AuthoredSource);
    let importer = fact(
        Path::new("/project/target.vue"),
        b"target",
        path,
        FactRole::LocalImporter,
    );
    let mut facts = NativeFacts::new(true);
    facts.retain_previous(&[body, importer.clone()], &[], &[path.to_path_buf()], &[]);
    facts.body(path, b"new");
    let packet = facts.finish(());
    assert_eq!(packet.stamps.len(), 2);
    assert_eq!(packet.stamps[0], importer);
    assert_eq!(
        packet.stamps[1],
        fact(path, b"new", path, FactRole::AuthoredSource)
    );
}

#[test]
fn a_fallback_configuration_owner_does_not_replace_actual_importer_ownership() {
    let source = Path::new("/project/A.vue");
    let input = Path::new("/project/node_modules/pkg/package.json");
    let importer = fact(input, b"pkg", source, FactRole::LocalImporter);
    let mut facts = NativeFacts::new(true);
    facts.record(
        Consumed {
            value: (),
            stamps: vec![importer.clone()],
            qualified: true,
        },
        FactRole::Configuration,
        Path::new("/project"),
    );
    assert_eq!(facts.finish(()).stamps, vec![importer]);
}

#[test]
fn factory_metadata_keeps_configuration_owner_through_borrowed_callbacks() {
    let path = Path::new("/project/tsconfig.json");
    let mut facts = NativeFacts::new(true);
    let packet = facts.factory(
        Consumed {
            value: (),
            stamps: vec![InputStamp::observed_source(path.to_path_buf(), b"{}")],
            qualified: true,
        },
        FactRole::Configuration,
        Path::new("/project"),
    );
    assert_eq!(
        packet.stamps[0].owner().unwrap().role,
        FactRole::Configuration
    );
    facts.record(packet, FactRole::LocalImporter, Path::new("/project/A.vue"));
    assert_eq!(facts.finish(()).stamps.len(), 1);
}

#[test]
fn an_unowned_retained_fact_keeps_the_complete_native_packet_cold() {
    let old = InputStamp::observed_source(PathBuf::from("/project/A.vue"), b"old");
    let mut facts = NativeFacts::new(true);
    facts.retain_previous(&[old.clone()], &[], &[], &[]);
    let packet = facts.finish(());
    assert!(!packet.qualified);
    assert_eq!(packet.stamps, vec![old]);
}

#[test]
fn retained_original_raw_body_preserves_its_actual_importer_owner() {
    let source = Path::new("/project/A.vue");
    let input = Path::new("/project/node_modules/pkg/package.json");
    let raw = InputStamp::capture(input)
        .with_consumed_source(b"pkg")
        .with_owner(Arc::new(super::FactOwner {
            path: source.to_path_buf(),
            role: FactRole::LocalImporter,
        }));
    let mut facts = NativeFacts::new(true);
    facts.record_owned(Consumed {
        value: (),
        stamps: vec![raw],
        qualified: true,
    });
    assert_eq!(
        facts.finish(()).stamps,
        vec![fact(input, b"pkg", source, FactRole::LocalImporter)]
    );
}

#[test]
fn completed_callback_keeps_an_unrevisited_shadow_predicate_for_validation() {
    let directory = tempfile::tempdir().unwrap();
    let importer = directory.path().join("App.vue");
    let manifest = directory.path().join("package.json");
    std::fs::write(&manifest, "{}").unwrap();
    let owner = Arc::new(FactOwner {
        path: importer.clone(),
        role: FactRole::LocalImporter,
    });
    let shadow = InputStamp::observed_is_file(manifest.clone(), manifest.is_file())
        .with_owner(Arc::clone(&owner));
    let membership = InputStamp::observed_package_input_member(manifest.clone()).with_owner(owner);
    let mut facts = NativeFacts::new(true);
    facts.retain_previous(&[shadow.clone(), membership], &[importer], &[], &[]);
    let packet = facts.finish(());
    assert_eq!(packet.stamps, vec![shadow.clone()]);
    assert_eq!(shadow.current_consumed_fact().as_ref(), Some(&shadow));
    std::fs::remove_file(&manifest).unwrap();
    assert_ne!(
        packet.stamps[0].current_consumed_fact().as_ref(),
        Some(&shadow)
    );
}

#[test]
fn truly_retired_importer_releases_its_probes_but_keeps_configuration_facts() {
    let importer = Path::new("/project/App.vue");
    let input = Path::new("/project/package.json");
    let probe =
        InputStamp::observed_is_file(input.to_path_buf(), true).with_owner(Arc::new(FactOwner {
            path: importer.to_path_buf(),
            role: FactRole::LocalImporter,
        }));
    let configuration = fact(input, b"{}", Path::new("/project"), FactRole::Configuration);
    let mut facts = NativeFacts::new(true);
    facts.retain_previous(
        &[probe.clone(), configuration.clone()],
        &[importer.to_path_buf()],
        &[],
        &[],
    );
    assert_eq!(facts.witness().stamps, vec![probe, configuration.clone()]);
    facts.remove_retired_owners(&vize_carton::FxHashSet::default());
    assert_eq!(facts.finish(()).stamps, vec![configuration]);
}

#[test]
fn completed_dependency_walk_replaces_only_its_actual_probe_scope() {
    let importer = Path::new("/project/Host.vue");
    let unfinished = Path::new("/project/Other.vue");
    let target = Path::new("/project/Child.vue");
    let probe = |owner: &Path, role| {
        InputStamp::observed_is_file(target.to_path_buf(), true).with_owner(Arc::new(FactOwner {
            path: owner.to_path_buf(),
            role,
        }))
    };
    let old_walk = probe(importer, FactRole::DependencyImporter);
    let other_walk = probe(unfinished, FactRole::DependencyImporter);
    let shadow = probe(importer, FactRole::LocalImporter);
    let config = probe(importer, FactRole::Configuration);
    let body = fact(target, b"body", target, FactRole::AuthoredSource);
    let old = vec![
        old_walk.clone(),
        other_walk.clone(),
        shadow.clone(),
        config.clone(),
        body.clone(),
    ];
    let mut pending = NativeFacts::new(true);
    pending.retain_previous(&old, &[], &[importer.to_path_buf()], &[]);
    assert_eq!(pending.finish(()).stamps, old);
    for qualified in [true, false] {
        let mut finished = NativeFacts::new(true);
        let current = probe(importer, FactRole::DependencyImporter);
        finished.record_owned(Consumed {
            value: (),
            stamps: vec![current.clone()],
            qualified,
        });
        finished.retain_previous(&old, &[importer.to_path_buf()], &[], &[]);
        let packet = finished.finish(());
        assert_eq!(
            packet.stamps,
            vec![
                current,
                other_walk.clone(),
                shadow.clone(),
                config.clone(),
                body.clone()
            ]
        );
        assert_eq!(packet.qualified, qualified);
    }
}

#[test]
fn editor_completion_and_dependency_completion_have_independent_input_lifetimes() {
    let importer = Path::new("/project/Host.vue");
    let target = Path::new("/project/Child.vue");
    let probe = |role| {
        InputStamp::observed_is_file(target.to_path_buf(), true).with_owner(Arc::new(FactOwner {
            path: importer.to_path_buf(),
            role,
        }))
    };
    let dependency = probe(FactRole::DependencyImporter);
    let editor = probe(FactRole::EditorImporter);
    let shadow = probe(FactRole::LocalImporter);
    let old = [dependency.clone(), editor.clone(), shadow.clone()];
    let complete = [importer.to_path_buf()];
    let mut edge_only = NativeFacts::new(true);
    edge_only.retain_previous_with_completed_editor(&old, (&complete, &[]), &[], &[], &[], &[]);
    assert_eq!(edge_only.finish(()).stamps, vec![editor, shadow.clone()]);
    let mut rewrite_only = NativeFacts::new(true);
    rewrite_only.retain_previous_with_completed_editor(&old, (&[], &complete), &[], &[], &[], &[]);
    assert_eq!(rewrite_only.finish(()).stamps, vec![dependency, shadow]);
}
