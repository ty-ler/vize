// PRIVATE source laws only: never compiled or executed in this preparation.
// Proposed scope: tsconfig_gen/references/ownership/consumed_selection_tests.rs.
use super::{Path, PathBuf, TsconfigOwnershipCache, TsconfigOwnershipOptions, TsconfigSourceKind};
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Case(PathBuf);
impl Case {
    fn new(name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(
            vize_carton::cstr!(
                "vize-config-leaf-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            )
            .as_str(),
        );
        fs::create_dir_all(&path).unwrap();
        Self(fs::canonicalize(path).unwrap())
    }
    fn config(&self, body: &str) -> PathBuf {
        let path = self.0.join("tsconfig.json");
        fs::write(&path, body).unwrap();
        path
    }
}
impl Drop for Case {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn single_leaf_returns_whole_root_for_both_membership_and_case_outcomes() {
    for case_sensitive in [false, true] {
        for includes in [false, true] {
            let case = Case::new("membership");
            let body = if includes {
                r#"{"files":["Host.vue"]}"#
            } else {
                r#"{"files":[]}"#
            };
            let config = case.config(body);
            let source = case.0.join("Host.vue");
            fs::write(&source, "<template/>").unwrap();
            let mut cache = TsconfigOwnershipCache::with_options(
                TsconfigOwnershipOptions::with_case_sensitive(case_sensitive),
            );
            assert_eq!(
                cache.project_owns_source(&config, &source, TsconfigSourceKind::Typed),
                includes
            );
            let observed = cache.effective_config_for_source_consumed(
                &config,
                &source,
                TsconfigSourceKind::Typed,
                true,
            );
            assert_eq!(
                observed.value,
                vize_carton::path::canonicalize_non_verbatim(&config)
            );
            assert!(observed.qualified);
            assert!(observed.stamps.iter().all(|stamp| stamp.is_current()));
        }
    }
}

#[test]
fn failed_cached_spec_and_actual_default_case_cannot_change_proven_leaf_output() {
    let case = Case::new("failed-spec");
    let config = case.config("{");
    let source = case.0.join("Host.vue");
    let mut cache = TsconfigOwnershipCache::default();
    assert!(!cache.project_owns_source(&config, &source, TsconfigSourceKind::Typed));
    case.config(r#"{"files":["Host.vue"]}"#);
    let observed = cache.effective_config_for_source_consumed(
        &config,
        &source,
        TsconfigSourceKind::Typed,
        true,
    );
    assert_eq!(
        observed.value,
        vize_carton::path::canonicalize_non_verbatim(&config)
    );
    assert!(observed.qualified);
    // This existing failed spec still executes and still cannot own the source.
    assert!(!cache.project_owns_source(&config, &source, TsconfigSourceKind::Typed));
}

#[test]
fn occupied_graph_and_references_are_cold_even_when_whole_selected_root_matches() {
    let case = Case::new("cache");
    let config = case.config(r#"{"files":[]}"#);
    let source = case.0.join("Host.vue");
    let mut cache = TsconfigOwnershipCache::default();
    let first = cache.effective_config_for_source_consumed(
        &config,
        &source,
        TsconfigSourceKind::Typed,
        true,
    );
    let second = cache.effective_config_for_source_consumed(
        &config,
        &source,
        TsconfigSourceKind::Typed,
        true,
    );
    assert!(first.qualified);
    assert_eq!(second.value, first.value);
    assert!(!second.qualified);
    for body in [
        r#"{"references":[{"path":"missing"}]}"#,
        r#"{"references":"unsupported"}"#,
    ] {
        case.config(body);
        let observed = TsconfigOwnershipCache::default().effective_config_for_source_consumed(
            &config,
            &source,
            TsconfigSourceKind::Typed,
            true,
        );
        assert_eq!(observed.value, first.value);
        assert!(!observed.qualified);
    }
}

#[test]
fn graph_read_or_parse_failures_and_relative_root_do_not_qualify() {
    let case = Case::new("errors");
    let config = case.config("{");
    let source = case.0.join("Host.vue");
    let parse = TsconfigOwnershipCache::default().effective_config_for_source_consumed(
        &config,
        &source,
        TsconfigSourceKind::Typed,
        true,
    );
    assert!(!parse.qualified);
    fs::remove_file(&config).unwrap();
    let read = TsconfigOwnershipCache::default().effective_config_for_source_consumed(
        &config,
        &source,
        TsconfigSourceKind::Typed,
        true,
    );
    assert_eq!(read.value, parse.value);
    assert!(!read.qualified);
    let relative = TsconfigOwnershipCache::default().effective_config_for_source_consumed(
        Path::new("tsconfig.json"),
        &source,
        TsconfigSourceKind::Typed,
        true,
    );
    assert!(!relative.qualified);
}

#[test]
fn same_operation_graph_body_rejects_late_reference_change() {
    let case = Case::new("late-body");
    let config = case.config(r#"{"files":[]}"#);
    let observed = TsconfigOwnershipCache::default().effective_config_for_source_consumed(
        &config,
        &case.0.join("Host.vue"),
        TsconfigSourceKind::Typed,
        true,
    );
    assert!(observed.qualified);
    case.config(r#"{"references":[{"path":"other"}]}"#);
    assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
}
