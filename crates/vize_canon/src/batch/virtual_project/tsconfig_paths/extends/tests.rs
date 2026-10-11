use super::{resolve_extended_tsconfig_path, resolve_extended_tsconfig_path_observed};

#[test]
fn relative_extends_preserves_exists_instead_of_substituting_file_eligibility() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    let directory = root.join("base");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(root.join("base.json"), "{}\n").unwrap();
    let original = resolve_extended_tsconfig_path(&config, "./base");
    let observed = resolve_extended_tsconfig_path_observed(&config, "./base");
    assert_eq!(original, Some(directory.clone()));
    assert_eq!(observed.value, original);
    assert!(observed.qualified);
    assert!(observed.stamps.iter().all(|stamp| stamp.is_current()));
    std::fs::remove_dir(&directory).unwrap();
    assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
}

#[test]
fn every_original_negative_candidate_refuses_a_later_higher_priority_config() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    let higher = root.join("base");
    let selected = root.join("base.json");
    std::fs::write(&selected, "{}\n").unwrap();
    let observed = resolve_extended_tsconfig_path_observed(&config, "./base");
    assert_eq!(observed.value, Some(selected));
    assert!(observed.stamps.iter().all(|stamp| stamp.is_current()));
    std::fs::write(&higher, "{}\n").unwrap();
    assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
    assert_eq!(
        resolve_extended_tsconfig_path(&config, "./base"),
        Some(higher)
    );
}

#[test]
fn a_package_manifest_field_is_bound_to_the_same_original_utf8_read() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    let package = root.join("node_modules/package");
    std::fs::create_dir_all(&package).unwrap();
    let manifest = package.join("package.json");
    std::fs::write(&manifest, "{\"tsconfig\":\"first.json\"}\n").unwrap();
    std::fs::write(package.join("first.json"), "{}\n").unwrap();
    std::fs::write(package.join("other.json"), "{}\n").unwrap();
    let observed = resolve_extended_tsconfig_path_observed(&config, "package");
    assert_eq!(
        observed.value,
        resolve_extended_tsconfig_path(&config, "package")
    );
    assert_eq!(observed.value, Some(package.join("first.json")));
    assert!(observed.stamps.iter().all(|stamp| stamp.is_current()));
    std::fs::write(&manifest, "{\"tsconfig\":\"other.json\"}\n").unwrap();
    assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
    assert_eq!(
        resolve_extended_tsconfig_path(&config, "package"),
        Some(package.join("other.json"))
    );
}

#[cfg(unix)]
#[test]
fn a_package_config_link_refuses_same_byte_canonical_retargeting() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    let first = root.join("first");
    let other = root.join("other");
    std::fs::create_dir(&first).unwrap();
    std::fs::create_dir(&other).unwrap();
    std::fs::write(first.join("tsconfig.json"), "{}\n").unwrap();
    std::fs::write(other.join("tsconfig.json"), "{}\n").unwrap();
    std::fs::create_dir(root.join("node_modules")).unwrap();
    let link = root.join("node_modules/package");
    std::os::unix::fs::symlink(&first, &link).unwrap();
    let observed = resolve_extended_tsconfig_path_observed(&config, "package/tsconfig.json");
    assert_eq!(observed.value, Some(first.join("tsconfig.json")));
    assert_eq!(
        observed.value,
        resolve_extended_tsconfig_path(&config, "package/tsconfig.json")
    );
    assert!(observed.stamps.iter().all(|stamp| stamp.is_current()));
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&other, &link).unwrap();
    assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
    assert_eq!(
        resolve_extended_tsconfig_path(&config, "package/tsconfig.json"),
        Some(other.join("tsconfig.json"))
    );
}
