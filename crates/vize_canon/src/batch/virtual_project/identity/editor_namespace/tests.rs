//! Uncompiled controls for the two original namespace canonical operations.

use super::{
    Path, project_virtual_root_with_identity, project_virtual_root_with_identity_observed,
};
use crate::package_route::stamp::InputStamp;

#[cfg(unix)]
#[test]
fn each_original_namespace_selection_refuses_independent_symlink_retarget() {
    let holder = tempfile::tempdir().unwrap();
    let holder = holder.path().canonicalize().unwrap();
    let project_one = holder.join("project-one");
    let project_two = holder.join("project-two");
    let storage_one = holder.join("storage-one");
    let storage_two = holder.join("storage-two");
    for path in [&project_one, &project_two, &storage_one, &storage_two] {
        std::fs::create_dir(path).unwrap();
    }
    let project = holder.join("project");
    let storage = holder.join("storage");
    std::os::unix::fs::symlink(&project_one, &project).unwrap();
    std::os::unix::fs::symlink(&storage_one, &storage).unwrap();
    let observed = project_virtual_root_with_identity_observed(&storage, &project, 31);
    let legacy = project_virtual_root_with_identity(&storage, &project, 31);
    assert_eq!(observed.value, legacy);
    assert!(observed.qualified);
    assert_eq!(
        observed.stamps,
        [
            InputStamp::observed_canonical_path(project.clone(), project_one.clone()),
            InputStamp::observed_canonical_path(storage.clone(), storage_one.clone()),
        ]
    );
    std::fs::remove_file(&project).unwrap();
    std::os::unix::fs::symlink(&project_two, &project).unwrap();
    assert!(!observed.stamps[0].is_current());
    assert!(observed.stamps[1].is_current());
    std::fs::remove_file(&project).unwrap();
    std::os::unix::fs::symlink(&project_one, &project).unwrap();
    std::fs::remove_file(&storage).unwrap();
    std::os::unix::fs::symlink(&storage_two, &storage).unwrap();
    assert!(observed.stamps[0].is_current());
    assert!(!observed.stamps[1].is_current());
}

#[test]
fn relative_namespace_inputs_keep_the_exact_legacy_value_and_stay_cold() {
    let storage = Path::new("relative-session");
    let project = Path::new("relative-project");
    let observed = project_virtual_root_with_identity_observed(storage, project, 7);
    assert_eq!(
        observed.value,
        project_virtual_root_with_identity(storage, project, 7)
    );
    assert_eq!(observed.stamps.len(), 2);
    assert!(!observed.qualified);
}
