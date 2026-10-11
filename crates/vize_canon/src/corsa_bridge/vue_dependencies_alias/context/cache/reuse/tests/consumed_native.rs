//! Actual observed-build and candidate laws; native diagnostics run separately.
use super::support::{CHILD, Fixture, HOST, facts, same_mtime_write};
use crate::corsa_bridge::EditorMirrorSession;
use crate::corsa_bridge::vue_dependencies_alias::AliasContext;
use crate::corsa_bridge::vue_dependencies_alias::context::PreparedAliasContext;
use crate::corsa_bridge::vue_dependencies_alias::context::cache::fingerprint::{
    ContextFingerprint, SourceGuard,
};
use crate::corsa_bridge::vue_dependencies_alias::context::cache::reuse::ReuseGuard;
use crate::corsa_bridge::vue_document::CorsaProjectEnvironment;
use std::path::{Path, PathBuf};
use vize_carton::FxHashMap;

mod ownership;

const IMPORTER: &str = "<script setup lang='ts'>import Widget from '@scope/ui'; import Missing from 'missing-owner';</script><template><Widget/><Missing/></template>";
const OWNER: &str = "<script setup lang='ts'>import Widget from '@scope/ui';</script><template><Widget/></template>";
const LOCAL: &str = "<template>released</template>";
const PAIR: &str = "<script setup lang='ts'>import A from './A.vue'; import B from './B.vue';</script><template><A/><B/></template>";

fn package(fixture: &Fixture) -> PathBuf {
    fixture.write(
        "package.json",
        "{\"name\":\"editor-control\",\"private\":true}\n",
    );
    fixture.write(
        "node_modules/@scope/ui/package.json",
        "{\"name\":\"@scope/ui\",\"exports\":{\".\":\"./Widget.vue\"}}\n",
    );
    fixture.write("node_modules/@scope/ui/Widget.vue", CHILD)
}

fn qualified(fixture: &Fixture) -> bool {
    fixture.session.cache().slots[&fixture.host]
        .fingerprint
        .consumed_inputs()
        .1
}

fn owners(context: &PreparedAliasContext, target: &Path) -> Vec<PathBuf> {
    let mut owners = context
        .mirror
        .as_ref()
        .unwrap()
        .current_package_route_bindings()
        .into_iter()
        .filter(|binding| {
            binding.route.as_ref().is_some_and(|route| {
                route
                    .all_source_paths()
                    .into_iter()
                    .any(|path| path == target)
            })
        })
        .map(|binding| binding.importer_path)
        .collect::<Vec<_>>();
    owners.sort();
    owners.dedup();
    owners
}

fn whole(
    fixture: &Fixture,
    context: &PreparedAliasContext,
    source: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    requested: &[(PathBuf, &str)],
) {
    let session = EditorMirrorSession::new();
    let cold = AliasContext::for_hosts_cached(
        &fixture.host,
        source,
        overlays,
        requested,
        fixture.options,
        CorsaProjectEnvironment {
            editor_session: &session,
            ..fixture.environment()
        },
    )
    .unwrap();
    let left = context.mirror.as_ref().unwrap();
    let right = cold.mirror.as_ref().unwrap();
    assert_eq!(
        left.virtual_root().as_os_str().len(),
        right.virtual_root().as_os_str().len()
    );
    assert_eq!(facts(context, &fixture.host), facts(&cold, &fixture.host));
    assert_eq!(context.aliases, cold.aliases);
    assert_eq!(context.package_routes, cold.package_routes);
    assert_eq!(context.route_inputs, cold.route_inputs);
    assert_eq!(
        left.current_package_route_bindings(),
        right.current_package_route_bindings()
    );
    assert_eq!(
        left.registered_original_paths_sorted(),
        right.registered_original_paths_sorted()
    );
    assert_eq!(
        left.package_route_source_paths(),
        right.package_route_source_paths()
    );
}

#[test]
fn actual_unknown_configuration_and_read_error_packets_keep_cold_authority() {
    for mode in 0..3 {
        let source = if mode == 0 {
            HOST.replace("Child.vue", "Broken.vue")
        } else {
            HOST.to_owned()
        };
        let fixture = Fixture::new(&source);
        if mode == 0 {
            let broken = fixture.write("src/Broken.vue", CHILD);
            std::fs::write(broken, [0xff]).unwrap();
        }
        let empty = FxHashMap::default();
        let first = fixture.open(&source, &empty);
        assert_eq!(qualified(&fixture), mode != 0);
        drop(first);
        let expected = match mode {
            0 => SourceGuard::UnknownAuthority,
            1 => {
                let config = fixture.root.join("tsconfig.json");
                let before = std::fs::read_to_string(&config).unwrap();
                same_mtime_write(&config, &before.replace("src/*", "lib/*"));
                SourceGuard::Configuration
            }
            _ => {
                let child = fixture.root.join("src/Child.vue");
                std::fs::remove_file(&child).unwrap();
                std::fs::create_dir(&child).unwrap();
                assert_ne!(
                    std::fs::read(&child).unwrap_err().kind(),
                    std::io::ErrorKind::NotFound
                );
                SourceGuard::ResolutionInput
            }
        };
        let edited = source.replace("count = 1", "count = 2");
        assert_eq!(fixture.guard(&edited, &empty), Err(expected));
        let refused = fixture.open(&edited, &empty);
        assert!(!refused.graph_reused);
        whole(&fixture, &refused, &edited, &empty, &[]);
    }
}

#[test]
fn actual_candidate_refuses_retiring_a_still_requested_package_seed() {
    let source = "<script setup lang='ts'>import Widget from '@scope/ui';</script><template><Widget/></template>";
    let fixture = Fixture::new(source);
    let target = package(&fixture);
    let requested = [(target.clone(), CHILD)];
    let empty = FxHashMap::default();
    let first = AliasContext::for_hosts_cached(
        &fixture.host,
        source,
        &empty,
        &requested,
        fixture.options,
        fixture.environment(),
    )
    .unwrap();
    assert!(qualified(&fixture));
    assert!(first.seed_paths.contains(&target));
    drop(first);
    let mut current = ContextFingerprint::capture(
        &fixture.host,
        LOCAL,
        &empty,
        fixture.options,
        &fixture.virtual_options,
        Some(&fixture.root),
        None,
    );
    current.include_requested_sources(&requested);
    let (cached, candidate) = fixture
        .session
        .cache()
        .get_for_rebuild(&fixture.host, &current);
    assert!(cached.is_none());
    let attempt = candidate.expect("actual old observed slot").rebuild(
        &current,
        &fixture.host,
        LOCAL,
        &empty,
        &requested,
        fixture.options,
        fixture.environment(),
    );
    let failure = match attempt {
        Ok(_) => panic!("protected seed cannot retire"),
        Err(failure) => failure,
    };
    assert_eq!(failure.guard, ReuseGuard::SourcePatch);
    let refused = AliasContext::for_hosts_cached(
        &fixture.host,
        LOCAL,
        &empty,
        &requested,
        fixture.options,
        fixture.environment(),
    )
    .unwrap();
    assert!(!refused.graph_reused);
    assert!(
        refused
            .mirror
            .as_ref()
            .unwrap()
            .find_by_original(&target)
            .is_some()
    );
    assert!(refused.seed_paths.contains(&target));
    whole(&fixture, &refused, LOCAL, &empty, &requested);
}

#[test]
fn inherited_unrooted_script_cycle_refuses_takeover_and_keeps_complete_cold_artifacts() {
    let source = "<script setup lang='ts'>import { a } from './A'; void a;</script><template>cycle</template>";
    let fixture = Fixture::new(source);
    let a = fixture.write("src/A.ts", "export { b } from './B'; export const a = 1;\n");
    let b = fixture.write("src/B.ts", "import { a } from './A'; export const b = a;\n");
    let empty = FxHashMap::default();
    let first = fixture.open(source, &empty);
    assert!(qualified(&fixture));
    let mirror = first.mirror.as_ref().unwrap();
    assert!(mirror.find_by_original(&a).is_some());
    assert!(mirror.find_by_original(&b).is_some());
    let artifacts = [
        mirror.preferred_materialized_path_for_original(&a).unwrap(),
        mirror.preferred_materialized_path_for_original(&b).unwrap(),
    ];
    assert!(artifacts.iter().all(|path| path.is_file()));
    drop(first);
    let removed = fixture.open(LOCAL, &empty);
    assert!(
        !removed.graph_reused,
        "an unresolved orphan cycle retains original cold authority"
    );
    let mirror = removed.mirror.as_ref().unwrap();
    assert!(mirror.find_by_original(&a).is_none());
    assert!(mirror.find_by_original(&b).is_none());
    assert!(artifacts.iter().all(|path| !path.exists()));
    whole(&fixture, &removed, LOCAL, &empty, &[]);
}
