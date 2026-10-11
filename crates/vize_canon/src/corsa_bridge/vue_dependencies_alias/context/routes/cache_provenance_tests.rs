//! Authored, unexecuted cache ownership laws for the private preparation.

use super::{CompilerAlias, PackageCallback, PackageOccurrence, ReachabilityCacheKey};
use super::{ReachabilityEntry, RouteDiscovery};
use crate::batch::virtual_project::PackageRouteReachability;
use crate::batch::virtual_project::package_resolution::PackageResolutionSettings;
use crate::package_route::stamp::{Consumed, InputStamp};
use std::path::PathBuf;
use vize_carton::FxHashMap;

const BODY: &str = "export interface Value {}\n";

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
        let physical_root = vize_carton::path::canonicalize_non_verbatim(root.path());
        let importer = physical_root.join("entry.ts");
        let package = physical_root.join("node_modules/typed-package");
        let declaration = package.join("index.d.ts");
        write(&physical_root.join("package.json"), r#"{"type":"module"}"#);
        write(
            &physical_root.join("tsconfig.json"),
            r#"{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}"#,
        );
        write(&importer, "import type { Value } from 'typed-package';\n");
        write(
            &package.join("package.json"),
            r#"{"name":"typed-package","types":"./index.d.ts"}"#,
        );
        write(&declaration, BODY);
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

    fn discovery(&mut self) -> RouteDiscovery<'_> {
        RouteDiscovery::new_observed(
            &self.settings,
            &mut self.resolver,
            &mut self.routes,
            &mut self.reachability,
            &mut self.bindings,
            &mut self.inputs,
            &self.aliases,
        )
    }

    fn resolve(&mut self) -> Consumed<PackageCallback> {
        let importer = self.importer.clone();
        self.discovery().resolve_observed(
            &importer,
            "typed-package",
            crate::PackageResolutionMode::Import,
        )
    }
}

#[test]
fn repeated_key_clones_complete_miss_facts_without_recounting_or_relabeling_aliases() {
    let mut harness = Harness::new();
    let first = harness.resolve();
    let first_stamps = first.stamps.clone();
    assert!(!first.qualified);
    let first = occurrence(first.value);
    let cached = harness.reachability.values().next().unwrap().clone();
    let second = harness.resolve();
    assert_eq!(second.stamps, first_stamps);
    assert!(!second.qualified);
    let second = occurrence(second.value);
    assert_occurrence(&first, &second);
    assert_eq!(harness.resolver.metrics().reachability_checks, 1);
    assert_eq!(harness.reachability.len(), 1);
    let retained = harness.reachability.values().next().unwrap();
    assert_reachability(&cached.value, &retained.value);
    assert_eq!(cached.facts.stamps, retained.facts.stamps);
    assert_eq!(cached.facts.value.failures, retained.facts.value.failures);
    assert_eq!(cached.facts.value.origin, retained.facts.value.origin);
    assert_eq!(cached.facts.qualified, retained.facts.qualified);

    harness
        .aliases
        .value
        .push(("@changed/*".into(), "./other/*".into()));
    let third = harness.resolve();
    assert!(!third.qualified);
    let third = occurrence(third.value);
    assert_eq!(third.reachability_origin, first.reachability_origin);
    let origin = third.reachability_origin.unwrap();
    assert_ne!(origin.aliases, harness.aliases.value);
    assert_eq!(origin.settings, harness.settings.value);
    assert!(!origin.aliases_qualified);
    assert!(!origin.settings_qualified);
    assert_eq!(harness.resolver.metrics().reachability_checks, 1);
    assert_eq!(harness.reachability.len(), 1);
}

#[test]
fn cached_stale_body_keeps_original_consumption_and_refuses_current_body_validation() {
    let mut harness = Harness::new();
    let first = harness.resolve();
    let first = occurrence(first.value);
    let old_body = InputStamp::observed_source(harness.declaration.clone(), BODY.as_bytes());
    let cached = harness.reachability.values().next().unwrap().clone();
    assert!(cached.facts.stamps.contains(&old_body));
    assert!(old_body.is_current());
    write(
        &harness.declaration,
        "export interface Changed { field: number }\n",
    );
    let second = harness.resolve();
    assert!(!second.qualified);
    assert!(second.stamps.contains(&old_body));
    assert!(!old_body.is_current());
    let second = occurrence(second.value);
    assert_reachability(&first.reachability, &second.reachability);
    assert_eq!(first.reachability_origin, second.reachability_origin);
    let retained = harness.reachability.values().next().unwrap();
    assert_eq!(retained.facts.stamps, cached.facts.stamps);
    assert_reachability(&retained.value, &cached.value);
    assert_eq!(harness.resolver.metrics().reachability_checks, 1);
    assert_eq!(harness.reachability.len(), 1);
}

#[test]
fn raw_positive_binding_none_packet_maps_once_and_never_claims_registered_roots() {
    let mut harness = Harness::new();
    let packet = harness.resolve();
    let occurrence = match &packet.value {
        PackageCallback::Occurrence(occurrence) => occurrence,
        PackageCallback::RuntimeSupport => panic!("expected original package occurrence"),
    };
    assert!(occurrence.raw_lookup.clone().into_parts().0.is_some());
    assert!(occurrence.binding.is_none());
    assert!(!occurrence.binding_registered);
    assert!(!occurrence.needs_shadow);
    assert!(!occurrence.track_reachability);
    assert!(!occurrence.watchable_negative);
    assert_eq!(
        occurrence.source_options,
        crate::PackageSourceOptions::new(true, true)
    );
    assert!(occurrence.route_inputs.contains(&harness.declaration));
    assert!(occurrence.failures.is_empty());
    assert!(harness.bindings.is_empty());
    assert!(harness.routes.is_empty());
    assert!(packet.stamps.contains(&InputStamp::observed_source(
        harness.declaration.clone(),
        BODY.as_bytes(),
    )));
    let original_stamps = packet.stamps.clone();
    let original_qualified = packet.qualified;
    let checks = harness.resolver.metrics().reachability_checks;
    let mapped = PackageCallback::into_shadow_result(packet);
    assert!(!mapped.value);
    assert_eq!(mapped.stamps, original_stamps);
    assert_eq!(mapped.qualified, original_qualified);
    assert!(!mapped.qualified);
    assert_eq!(harness.resolver.metrics().reachability_checks, checks);
    assert_eq!(checks, 1);
}

#[test]
fn complete_original_packets_qualify_scan_output_and_refuse_new_alias_domain_on_hit() {
    let mut harness = Harness::new();
    let root = harness.importer.parent().unwrap().to_path_buf();
    let project = crate::batch::virtual_project::VirtualProject::new(&root).unwrap();
    harness.settings = project.package_resolution_settings_observed();
    harness.aliases = project.dependency_alias_map_observed();
    assert!(harness.settings.qualified);
    assert!(harness.aliases.qualified);
    let child = harness.declaration.parent().unwrap().join("child.ts");
    let entry_body = "export { Child } from './child';\n";
    let child_body = "export interface Child { value: number }\n";
    write(&harness.declaration, entry_body);
    write(&child, child_body);
    let first = harness.resolve();
    assert!(first.qualified);
    assert!(first.stamps.iter().all(InputStamp::is_current));
    assert!(first.stamps.contains(&InputStamp::observed_source(
        harness.declaration.clone(),
        entry_body.as_bytes(),
    )));
    assert!(first.stamps.contains(&InputStamp::observed_source(
        child.clone(),
        child_body.as_bytes()
    )));
    assert!(first.stamps.contains(&InputStamp::observed_metadata_len(
        child.clone(),
        Ok(child_body.len() as u64)
    )));
    assert!(first.stamps.contains(&InputStamp::observed_is_file(
        child.with_extension("ts"),
        true
    )));
    let old_stamps = first.stamps.clone();
    let first = occurrence(first.value);
    let origin = first.reachability_origin.as_ref().unwrap();
    assert!(origin.raw_lookup_qualified);
    assert!(origin.context_qualified);
    assert!(origin.settings_qualified);
    assert!(origin.aliases_qualified);
    assert_eq!(
        first.reachability.outcome,
        crate::batch::virtual_project::ReachabilityOutcome::DoesNotReachVue
    );
    assert_eq!(first.reachability.work.files, 2);
    assert_eq!(first.reachability.work.parses, 2);
    assert_eq!(first.reachability.work.edges, 1);
    assert_eq!(first.reachability.work.packages, 1);
    assert_eq!(
        first.reachability.work.bytes,
        entry_body.len() + child_body.len()
    );
    assert!(first.failures.is_empty());
    assert!(first.binding.is_none());
    assert!(!first.binding_registered);
    let second = harness.resolve();
    assert!(second.qualified);
    assert_eq!(second.stamps, old_stamps);
    assert_occurrence(&first, &occurrence(second.value));
    assert_eq!(harness.resolver.metrics().reachability_checks, 1);

    write(
        &root.join("tsconfig.json"),
        r#"{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","paths":{"@changed/*":["./other/*"]}}}"#,
    );
    harness.settings = project.package_resolution_settings_observed();
    harness.aliases = project.dependency_alias_map_observed();
    assert!(harness.settings.qualified);
    assert!(harness.aliases.qualified);
    let changed = harness.resolve();
    assert!(!changed.qualified);
    assert!(changed.stamps.iter().any(|stamp| !stamp.is_current()));
    let changed = occurrence(changed.value);
    assert_eq!(changed.reachability_origin, first.reachability_origin);
    assert_ne!(
        changed.reachability_origin.unwrap().aliases,
        harness.aliases.value
    );
    assert_reachability(&changed.reachability, &first.reachability);
    assert_eq!(harness.resolver.metrics().reachability_checks, 1);
    assert_eq!(harness.reachability.len(), 1);
}

fn occurrence(callback: PackageCallback) -> PackageOccurrence {
    match callback {
        PackageCallback::Occurrence(occurrence) => *occurrence,
        PackageCallback::RuntimeSupport => panic!("expected original package occurrence"),
    }
}

fn assert_reachability(left: &PackageRouteReachability, right: &PackageRouteReachability) {
    assert_eq!(left.outcome, right.outcome);
    assert_eq!(left.inputs, right.inputs);
    assert_eq!(left.work, right.work);
}

fn assert_occurrence(left: &PackageOccurrence, right: &PackageOccurrence) {
    assert_eq!(left.source_options, right.source_options);
    assert_eq!(left.context, right.context);
    assert_eq!(left.context_inputs, right.context_inputs);
    assert_eq!(left.raw_lookup, right.raw_lookup);
    assert_reachability(&left.reachability, &right.reachability);
    assert_eq!(left.failures, right.failures);
    assert_eq!(left.reachability_origin, right.reachability_origin);
    assert_eq!(left.needs_shadow, right.needs_shadow);
    assert_eq!(left.track_reachability, right.track_reachability);
    assert_eq!(left.watchable_negative, right.watchable_negative);
    assert_eq!(left.route_inputs, right.route_inputs);
    assert_eq!(left.binding, right.binding);
    assert_eq!(left.binding_registered, right.binding_registered);
}

fn write(path: &std::path::Path, content: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}
