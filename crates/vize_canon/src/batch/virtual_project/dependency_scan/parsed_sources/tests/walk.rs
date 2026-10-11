use super::super::ParsedDependencySources;
use crate::batch::virtual_project::VirtualProject;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp, Shared};
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, String};

#[expect(
    clippy::disallowed_types,
    reason = "complete regression state rendering"
)]
#[expect(
    clippy::disallowed_macros,
    reason = "complete regression state rendering"
)]
fn state(project: &VirtualProject) -> std::string::String {
    format!("{project:?}")
}

fn run(
    project: &mut VirtualProject,
    overlays: &FxHashMap<PathBuf, &str>,
    parsed: Option<&mut ParsedDependencySources>,
    callbacks: &mut Vec<(PathBuf, String, crate::PackageResolutionMode)>,
) -> Consumed<Vec<PathBuf>> {
    let mut resolver = |importer: &Path, specifier: &str, mode| {
        callbacks.push((importer.to_path_buf(), specifier.into(), mode));
        Consumed {
            value: false,
            qualified: true,
            stamps: vec![
                InputStamp::observed_exists(importer.with_extension("consulted.json"), false)
                    .with_owner(Shared::new(FactOwner {
                        path: importer.to_path_buf(),
                        role: FactRole::LocalImporter,
                    })),
            ],
        }
    };
    project
        .register_reachable_dependencies_with_parsed_sources_observed(
            overlays,
            &[],
            &mut resolver,
            None,
            parsed,
        )
        .unwrap()
}

fn equal_owner_sharing(left: &[InputStamp], right: &[InputStamp]) {
    assert_eq!(left, right);
    for (i, before) in left.iter().enumerate() {
        for (j, other) in left.iter().enumerate() {
            let shared = before
                .owner()
                .zip(other.owner())
                .is_some_and(|(a, b)| std::ptr::eq(a, b));
            let current = right[i]
                .owner()
                .zip(right[j].owner())
                .is_some_and(|(a, b)| std::ptr::eq(a, b));
            assert_eq!(shared, current);
        }
    }
}

#[test]
fn retained_parsing_preserves_every_actual_walk_callback_fact_edge_and_refusal() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let host = root.join("Host.ts");
    let child = root.join("Child.ts");
    let other = root.join("Other.ts");
    let unreadable = root.join("Unreadable.ts");
    let initial = "import './Child'; import './Other'; import './Missing'; import './Unreadable'; import 'bare'; const x = require('bare'); export {};";
    std::fs::write(&host, initial).unwrap();
    std::fs::write(&child, "export const child = 1;\n").unwrap();
    std::fs::write(&other, "export const other = 1;\n").unwrap();
    std::fs::write(&unreadable, [0xff, 0xfe]).unwrap();
    let mut original = VirtualProject::new(&root).unwrap();
    let mut candidate = VirtualProject::new(&root).unwrap();
    for project in [&mut original, &mut candidate] {
        project.set_session_script_registration(true);
        project.register_path(&host).unwrap();
    }
    let mut parsed = ParsedDependencySources::default();
    for wave in 0..6 {
        let mut overlays = FxHashMap::default();
        if wave == 2 {
            std::fs::write(&child, "export const child = 2;\n").unwrap();
            for project in [&mut original, &mut candidate] {
                project.register_path(&child).unwrap();
            }
        }
        if wave == 3 {
            std::fs::remove_file(&other).unwrap();
            overlays.insert(other.clone(), "export const unsaved = 1;\n");
            let source = "/// <reference path='./Other.ts' />\nimport './Child'; import './Other'; import 'bare'; export {};";
            for project in [&mut original, &mut candidate] {
                project.register_path_with_content(&host, source).unwrap();
            }
        }
        if wave == 4 {
            std::fs::write(&other, "export const repaired = 1;\n").unwrap();
            for project in [&mut original, &mut candidate] {
                project.register_path(&other).unwrap();
            }
        }
        let mut old_calls = Vec::new();
        let mut new_calls = Vec::new();
        let before = run(&mut original, &overlays, None, &mut old_calls);
        let after = run(&mut candidate, &overlays, Some(&mut parsed), &mut new_calls);
        assert_eq!(before.value, after.value);
        assert_eq!(before.qualified, after.qualified);
        equal_owner_sharing(&before.stamps, &after.stamps);
        assert_eq!(old_calls, new_calls);
        assert_eq!(state(&original), state(&candidate));
        if wave == 0 {
            assert!(!after.qualified);
            assert!(after.stamps.iter().any(|stamp| stamp.path() == unreadable));
            assert!(!new_calls.is_empty());
        }
    }
    assert!(parsed.hits > parsed.parses);
}
