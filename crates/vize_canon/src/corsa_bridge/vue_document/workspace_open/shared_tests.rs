//! Existing immutable owners survive the actual worker preparation capture.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::ThreadId;

use super::{
    CorsaBridge, CorsaBridgeError, CorsaProjectEnvironment, String, VirtualTsOptions,
    build_vue_virtual_workspace_project, open_owned,
};

struct ObservedSource {
    source: Arc<str>,
    original_address: usize,
    caller: ThreadId,
    ordinal: usize,
    observed: Arc<Mutex<Vec<usize>>>,
}

impl AsRef<str> for ObservedSource {
    fn as_ref(&self) -> &str {
        // An eager caller-side materialization, even with identical bytes,
        // loses the original producer's shared-owner transport contract.
        assert_ne!(std::thread::current().id(), self.caller);
        assert_eq!(self.source.as_ptr() as usize, self.original_address);
        self.observed.lock().unwrap().push(self.ordinal);
        &self.source
    }
}

#[test]
fn shared_sources_keep_original_pointees_and_whole_project_on_the_actual_worker() {
    let storage = tempfile::tempdir().unwrap();
    let root = vize_carton::path::canonicalize_non_verbatim(storage.path());
    let host = root.join("Host.vue");
    let child = root.join("Child.vue");
    let other = root.join("Other.vue");
    let host_source = "<script setup lang='ts'>import Child from './Child.vue'; const title = '日本語 🦀';</script><template><Child :title=\"title\" /></template>";
    let child_source = "<script setup lang='ts'>defineProps<{ title: string }>();</script><template>{{ title }}</template>";
    let other_source = "<script setup lang='ts'>const unrelated: number = 7;</script><template>{{ unrelated }}</template>";
    std::fs::write(&host, host_source).unwrap();
    std::fs::write(&child, "<template>old disk child</template>").unwrap();
    std::fs::write(&other, "<template>old disk unrelated</template>").unwrap();
    let bridge = CorsaBridge::with_config(crate::corsa_bridge::CorsaBridgeConfig {
        working_dir: Some(root.clone()),
        ..Default::default()
    });
    let options = VirtualTsOptions::default();
    let overlays = vec![
        (child.clone(), "<template>overridden duplicate</template>"),
        (child.clone(), child_source),
        (other.clone(), other_source),
    ];
    let requested = vec![(other.clone(), other_source), (host.clone(), host_source)];
    let environment = CorsaProjectEnvironment {
        virtual_ts_options: &options,
        package_routes: &bridge.package_route_resolver,
        project_root: Some(&root),
        tsconfig_path: None,
        editor_session: &bridge.editor_session,
    };
    build_vue_virtual_workspace_project(
        &host,
        host_source,
        Default::default(),
        &overlays,
        &requested,
        environment,
    )
    .unwrap();
    // Read the complete original prepared cache through the same public builder;
    // both comparisons therefore retain the original warm materialization delta.
    let before = build_vue_virtual_workspace_project(
        &host,
        host_source,
        Default::default(),
        &overlays,
        &requested,
        environment,
    )
    .unwrap();
    bridge.editor_session.clear();
    let owners = overlays
        .iter()
        .chain(&requested)
        .map(|(_, source)| Arc::<str>::from(*source))
        .collect::<Vec<_>>();
    // The old transport copies these exact cached owners into CompactString.
    let copied = super::own_sources(
        &overlays
            .iter()
            .enumerate()
            .map(|(index, (path, _))| (path.clone(), &*owners[index]))
            .collect::<Vec<_>>(),
    );
    for ((_, copy), original) in copied.iter().zip(&owners) {
        assert_eq!(copy.as_str(), &**original);
        assert_ne!(copy.as_ptr(), original.as_ptr());
    }
    let observed = Arc::new(Mutex::new(Vec::new()));
    let capture = |pairs: &[(PathBuf, &str)], offset: usize| {
        pairs
            .iter()
            .enumerate()
            .map(|(index, (path, _))| {
                let original = &owners[offset + index];
                (
                    path.clone(),
                    ObservedSource {
                        source: Arc::clone(original),
                        original_address: original.as_ptr() as usize,
                        caller: std::thread::current().id(),
                        ordinal: offset + index,
                        observed: Arc::clone(&observed),
                    },
                )
            })
            .collect::<Vec<_>>()
    };
    let result = futures::executor::block_on(open_owned(
        &bridge,
        host.clone(),
        String::from(host_source),
        Default::default(),
        capture(&overlays, 0),
        options.clone(),
        capture(&requested, overlays.len()),
    ));
    // Preparation actually completed before the existing initialization guard.
    assert!(matches!(result, Err(CorsaBridgeError::NotInitialized)));
    assert_eq!(
        *observed.lock().unwrap(),
        (0..owners.len()).collect::<Vec<_>>()
    );
    let after = build_vue_virtual_workspace_project(
        &host,
        host_source,
        Default::default(),
        &overlays,
        &requested,
        environment,
    )
    .unwrap();
    super::tests::assert_same_project(&after, &before);
}
