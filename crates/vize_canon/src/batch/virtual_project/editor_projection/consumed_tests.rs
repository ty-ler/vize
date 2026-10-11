//! Unexecuted original-finalizer controls; overall graph qualification is separate.
use super::{VirtualProject, VueDocumentVirtualTsOptions};
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vize_carton::{String, cstr};

fn project(root: &Path, sources: &[PathBuf]) -> VirtualProject {
    let mut value = VirtualProject::new(root).unwrap();
    value.set_editor_document_options(VueDocumentVirtualTsOptions::default());
    for path in sources {
        value.register_path(path).unwrap();
    }
    value
}

fn snapshot(project: &VirtualProject) -> Vec<(PathBuf, PathBuf, String, String)> {
    project
        .virtual_files_sorted()
        .into_iter()
        .map(|file| {
            (
                file.original_path.clone(),
                file.virtual_path.clone(),
                file.content.clone(),
                cstr!("{:?}", file.source_map),
            )
        })
        .collect()
}

fn same(left: &VirtualProject, right: &VirtualProject) {
    assert_eq!(snapshot(left), snapshot(right));
    assert_eq!(left.original_contents, right.original_contents);
    assert_eq!(left.pre_rewrite_code, right.pre_rewrite_code);
    assert_eq!(left.original_index, right.original_index);
    assert_eq!(left.dependency_edges, right.dependency_edges);
    assert_eq!(left.dependency_inbound, right.dependency_inbound);
}

#[test]
fn finalization_reloads_late_alias_b_instead_of_reusing_the_prior_a_packet() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    std::fs::create_dir(root.join("a")).unwrap();
    std::fs::create_dir(root.join("b")).unwrap();
    let a = root.join("a/dep.ts");
    let b = root.join("b/dep.ts");
    let host = root.join("entry.ts");
    std::fs::write(&a, "export const value = 'a';").unwrap();
    std::fs::write(&b, "export const value = 'b';").unwrap();
    std::fs::write(&host, "import { value } from '@/dep'; export { value };").unwrap();
    std::fs::write(&config, r#"{"compilerOptions":{"paths":{"@/*":["a/*"]}}}"#).unwrap();
    let sources = [host.clone(), a, b.clone()];
    let mut legacy = project(&root, &sources);
    let mut observed = project(&root, &sources);
    let prior = observed.dependency_alias_map_observed();
    std::fs::write(&config, r#"{"compilerOptions":{"paths":{"@/*":["b/*"]}}}"#).unwrap();
    let current = observed.dependency_alias_map_observed();
    assert_ne!(prior.value, current.value);
    assert!(prior.stamps.iter().any(|stamp| !stamp.is_current()));
    legacy.finalize_editor_imports();
    let packet = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(packet.qualified);
    assert!(packet.stamps.iter().any(|stamp| {
        stamp
            .owner()
            .is_some_and(|owner| owner.role == FactRole::Configuration)
    }));
    let target = observed
        .find_by_original(&b)
        .unwrap()
        .virtual_path
        .to_string_lossy()
        .replace('\\', "/");
    assert!(
        observed
            .find_by_original(&host)
            .unwrap()
            .content
            .contains(target.as_str())
    );
    std::fs::write(&config, "{}").unwrap();
    assert!(packet.stamps.iter().any(|stamp| !stamp.is_current()));
}

#[test]
fn a_missing_then_present_sfc_replaces_the_exact_fallback_probe_facts() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let host = root.join("entry.ts");
    let missing = root.join("Missing.vue");
    std::fs::write(
        &host,
        "import Missing from './Missing.vue'; export { Missing };",
    )
    .unwrap();
    let mut legacy = project(&root, std::slice::from_ref(&host));
    let mut observed = project(&root, std::slice::from_ref(&host));
    legacy.finalize_editor_imports();
    let old = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(old.qualified);
    let owner = Arc::new(FactOwner {
        path: host.clone(),
        role: FactRole::LocalImporter,
    });
    assert!(old.stamps.contains(
        &InputStamp::observed_try_exists(missing.clone(), Ok(false),).with_owner(owner.clone())
    ));
    let before = snapshot(&observed);
    std::fs::write(&missing, "<template />").unwrap();
    assert!(old.stamps.iter().any(|stamp| !stamp.is_current()));
    legacy.finalize_editor_imports();
    let current = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(current.qualified);
    assert_ne!(before, snapshot(&observed));
    assert!(
        current
            .stamps
            .contains(&InputStamp::observed_try_exists(missing, Ok(true)).with_owner(owner),)
    );
}

#[test]
fn actual_try_exists_errors_keep_original_code_and_refuse_qualification() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let host = root.join("entry.ts");
    std::fs::write(
        &host,
        "import Missing from './invalid\\u0000.vue'; export { Missing };",
    )
    .unwrap();
    let actual = root
        .join("./invalid\0.vue")
        .try_exists()
        .unwrap_err()
        .kind();
    let mut legacy = project(&root, std::slice::from_ref(&host));
    let mut observed = project(&root, std::slice::from_ref(&host));
    legacy.finalize_editor_imports();
    let packet = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(!packet.qualified);
    let expected = InputStamp::observed_try_exists(root.join("./invalid\0.vue"), Err(actual))
        .with_owner(Arc::new(FactOwner {
            path: host,
            role: FactRole::LocalImporter,
        }));
    assert!(packet.stamps.contains(&expected));
}

#[test]
fn absent_editor_options_and_unknown_late_alias_config_stay_cold() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    std::fs::write(&config, "{}").unwrap();
    let mut no_editor = VirtualProject::new(&root).unwrap();
    let packet = no_editor.finalize_editor_imports_observed();
    assert!(!packet.qualified && packet.stamps.is_empty());
    let host = root.join("entry.ts");
    std::fs::write(&host, "export const value = 1;").unwrap();
    let mut legacy = project(&root, std::slice::from_ref(&host));
    let mut observed = project(&root, std::slice::from_ref(&host));
    std::fs::write(&config, "{").unwrap();
    legacy.finalize_editor_imports();
    let packet = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(!packet.qualified);
}

#[cfg(unix)]
#[test]
fn the_original_selected_canonical_identity_refuses_a_retargeted_link() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let a = root.join("a.ts");
    let b = root.join("b.ts");
    let link = root.join("linked.ts");
    let host = root.join("entry.ts");
    std::fs::write(&a, "export const value = 1;").unwrap();
    std::fs::write(&b, "export const value = 2;").unwrap();
    std::fs::write(
        &host,
        "import { value } from './linked.ts'; export { value };",
    )
    .unwrap();
    std::os::unix::fs::symlink(&a, &link).unwrap();
    let sources = [host, a.clone(), b.clone()];
    let mut legacy = project(&root, &sources);
    let mut observed = project(&root, &sources);
    legacy.finalize_editor_imports();
    let old = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(old.qualified);
    assert!(old.stamps.iter().any(|stamp| {
        stamp
            .consumed_canonical_selection()
            .is_some_and(|(path, selected)| path == link && selected == a)
    }));
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&b, &link).unwrap();
    assert!(old.stamps.iter().any(|stamp| !stamp.is_current()));
    legacy.finalize_editor_imports();
    let current = observed.finalize_editor_imports_observed();
    same(&legacy, &observed);
    assert!(current.qualified);
    assert!(current.stamps.iter().any(|stamp| {
        stamp
            .consumed_canonical_selection()
            .is_some_and(|(path, selected)| path == link && selected == b)
    }));
}
