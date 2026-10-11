//! Unexecuted controls of the actual existing editor callback operation.

use super::{
    CompilerAlias, PackageCallback, ReachabilityCacheKey, ReachabilityEntry, RouteDiscovery,
};
use crate::batch::virtual_project::VirtualProject;
use crate::batch::virtual_project::package_resolution::PackageResolutionSettings;
use crate::package_route::stamp::{Consumed, FactRole, InputStamp, PackageContributionRef};
use std::path::{Path, PathBuf};
use vize_carton::FxHashMap;

struct Harness {
    _root: tempfile::TempDir,
    importer: PathBuf,
    declaration: PathBuf,
    settings: Consumed<PackageResolutionSettings>,
    aliases: Consumed<Vec<CompilerAlias>>,
    resolver: crate::PackageRouteResolver,
    routes: FxHashMap<(PathBuf, vize_carton::String), crate::PackageRoute>,
    reachability: FxHashMap<ReachabilityCacheKey, ReachabilityEntry>,
    bindings: Vec<crate::PackageRouteBinding>,
    inputs: Vec<PathBuf>,
}

impl Harness {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let physical = vize_carton::path::canonicalize_non_verbatim(root.path());
        let importer = physical.join("entry.ts");
        let package = physical.join("node_modules/typed-package");
        let declaration = package.join("index.d.ts");
        write(
            &physical.join("package.json"),
            r##"{"type":"module","imports":{"#child":"./Child.vue","#missing":"./missing.vue"}}"##,
        );
        write(
            &physical.join("tsconfig.json"),
            r#"{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}"#,
        );
        write(&importer, "export {};\n");
        write(
            &physical.join("Child.vue"),
            "<template><div /></template>\n",
        );
        write(
            &package.join("package.json"),
            r#"{"name":"typed-package","types":"./index.d.ts"}"#,
        );
        write(&declaration, "export interface Value {}\n");
        Self {
            _root: root,
            importer,
            declaration,
            settings: Consumed {
                value: PackageResolutionSettings::default(),
                stamps: Vec::new(),
                qualified: false,
            },
            aliases: Consumed {
                value: Vec::new(),
                stamps: Vec::new(),
                qualified: false,
            },
            resolver: crate::PackageRouteResolver::default(),
            routes: FxHashMap::default(),
            reachability: FxHashMap::default(),
            bindings: Vec::new(),
            inputs: Vec::new(),
        }
    }
    fn observe_configuration(&mut self) {
        let project = VirtualProject::new(self.importer.parent().unwrap()).unwrap();
        self.settings = project.package_resolution_settings_observed();
        self.aliases = project.dependency_alias_map_observed();
        assert!(self.settings.qualified && self.aliases.qualified);
    }
    fn resolve(&mut self, specifier: &str) -> Consumed<PackageCallback> {
        let importer = self.importer.clone();
        RouteDiscovery::new_observed(
            &self.settings,
            &mut self.resolver,
            &mut self.routes,
            &mut self.reachability,
            &mut self.bindings,
            &mut self.inputs,
            &self.aliases,
        )
        .resolve_observed(&importer, specifier, crate::PackageResolutionMode::Import)
    }
}
fn write(path: &Path, content: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}
fn marker_inputs(stamps: &[InputStamp]) -> Vec<PathBuf> {
    let mut inputs = stamps
        .iter()
        .filter_map(|stamp| match stamp.package_contribution() {
            Some(PackageContributionRef::Input(path)) => Some(path.to_path_buf()),
            _ => None,
        })
        .collect::<Vec<_>>();
    inputs.sort();
    inputs.dedup();
    inputs
}
fn assert_markers(stamps: &[InputStamp], importer: &Path, original_inputs: &[PathBuf]) {
    let mut expected = original_inputs.to_vec();
    expected.sort();
    expected.dedup();
    assert_eq!(marker_inputs(stamps), expected);
    assert!(
        stamps
            .iter()
            .filter(|stamp| stamp.package_contribution().is_some())
            .all(|stamp| stamp.owner().is_some_and(
                |owner| owner.role == FactRole::LocalImporter && owner.path == importer
            ))
    );
}

#[test]
fn runtime_support_qualifies_its_pure_branch_without_any_resolver_or_map_operation() {
    let mut harness = Harness::new();
    let before = harness.resolver.metrics();
    for specifier in [
        "vue",
        "vue/dist/vue.cjs.js",
        "vue/server-renderer",
        "vue/jsx-runtime",
        "@vue/runtime-core",
        "@vue/runtime-dom",
        "vite/client",
    ] {
        let packet = harness.resolve(specifier);
        assert!(matches!(packet.value, PackageCallback::RuntimeSupport));
        assert!(packet.qualified);
        assert!(packet.stamps.is_empty());
        let mapped = PackageCallback::into_shadow_result(packet);
        assert!(!mapped.value);
        assert!(mapped.qualified && mapped.stamps.is_empty());
    }
    assert_eq!(harness.resolver.metrics(), before);
    assert!(harness.routes.is_empty() && harness.reachability.is_empty());
    assert!(harness.bindings.is_empty() && harness.inputs.is_empty());
    assert!(!harness.settings.qualified && !harness.aliases.qualified);
}

#[test]
fn complete_watchable_negative_qualifies_empty_reachability_without_requiring_a_miss_origin() {
    let mut harness = Harness::new();
    harness.observe_configuration();
    let packet = harness.resolve("#missing");
    assert!(packet.qualified);
    let PackageCallback::Occurrence(occurrence) = &packet.value else {
        panic!("occurrence required");
    };
    assert!(occurrence.raw_lookup.clone().into_parts().0.is_none());
    assert!(occurrence.watchable_negative);
    assert!(!occurrence.needs_shadow && !occurrence.track_reachability);
    assert!(occurrence.reachability_origin.is_none());
    assert!(occurrence.failures.is_empty());
    assert!(!occurrence.binding_registered);
    assert!(occurrence.binding.as_ref().unwrap().route.is_none());
    assert_markers(&packet.stamps, &harness.importer, &occurrence.route_inputs);
    assert!(!marker_inputs(&packet.stamps).is_empty());
    assert!(harness.reachability.is_empty() && harness.routes.is_empty());
    assert_eq!(harness.resolver.metrics().reachability_checks, 0);
    let original_stamps = packet.stamps.clone();
    let before = harness.resolver.metrics();
    let mapped = PackageCallback::into_shadow_result(packet);
    assert!(!mapped.value);
    assert!(mapped.qualified);
    assert_eq!(mapped.stamps, original_stamps);
    assert_eq!(harness.resolver.metrics(), before);
    let mut incomplete = Harness::new();
    assert!(!incomplete.resolve("#missing").qualified);
}

#[test]
fn raw_positive_binding_none_keeps_actual_input_membership_without_invented_route_writes() {
    let mut harness = Harness::new();
    harness.observe_configuration();
    let packet = harness.resolve("typed-package");
    assert!(packet.qualified);
    let PackageCallback::Occurrence(occurrence) = &packet.value else {
        panic!("occurrence required");
    };
    assert!(occurrence.raw_lookup.clone().into_parts().0.is_some());
    assert!(occurrence.binding.is_none() && !occurrence.binding_registered);
    assert!(
        !occurrence.needs_shadow
            && !occurrence.track_reachability
            && !occurrence.watchable_negative
    );
    assert!(occurrence.route_inputs.contains(&harness.declaration));
    assert_markers(&packet.stamps, &harness.importer, &occurrence.route_inputs);
    assert!(packet.stamps.iter().all(|stamp| !matches!(
        stamp.package_contribution(),
        Some(PackageContributionRef::Route { .. })
    )));
    assert!(harness.bindings.is_empty() && harness.routes.is_empty());
    let original_stamps = packet.stamps.clone();
    let before = harness.resolver.metrics();
    let mapped = PackageCallback::into_shadow_result(packet);
    assert!(!mapped.value && mapped.qualified);
    assert_eq!(mapped.stamps, original_stamps);
    assert_eq!(harness.resolver.metrics(), before);
}

#[test]
fn exact_original_editor_insert_records_whole_value_and_importer_not_pending_root_authority() {
    let mut harness = Harness::new();
    harness.observe_configuration();
    let packet = harness.resolve("#child");
    assert!(packet.qualified);
    let PackageCallback::Occurrence(occurrence) = &packet.value else {
        panic!("occurrence required");
    };
    assert!(occurrence.needs_shadow && !occurrence.binding_registered);
    let original_route = occurrence.raw_lookup.clone().into_parts().0.unwrap();
    let key = (
        harness.importer.parent().unwrap().to_path_buf(),
        "#child".into(),
    );
    assert_eq!(harness.routes.get(&key), Some(&original_route));
    assert_eq!(harness.routes.len(), 1);
    let writes = packet
        .stamps
        .iter()
        .filter_map(InputStamp::package_contribution)
        .filter(|value| matches!(value, PackageContributionRef::Route { .. }))
        .collect::<Vec<_>>();
    assert_eq!(
        writes,
        vec![PackageContributionRef::Route {
            directory: &key.0,
            specifier: &key.1,
            route: &original_route,
        }]
    );
    assert_markers(&packet.stamps, &harness.importer, &occurrence.route_inputs);
    assert!(occurrence.binding.as_ref().unwrap().route.is_some());
    assert_eq!(harness.bindings.len(), 1);
    assert_eq!(
        occurrence.source_options,
        crate::PackageSourceOptions::new(true, true)
    );
}
