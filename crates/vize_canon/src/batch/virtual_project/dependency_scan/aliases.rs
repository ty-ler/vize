//! Original alias-map and registration settings, without an extra load.
use super::VirtualProject;
use std::path::Path;
#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
impl VirtualProject {
    /// The effective `paths` aliases with project-root-relative targets, as
    /// (pattern, target) pairs. Both come from the flattened chain, so the
    /// anchors match what the generated tsconfig resolves (#3886).
    /// Opt an editor session into registering reachable in-root scripts (#3915).
    pub(crate) fn set_session_script_registration(&mut self, enabled: bool) {
        self.session_scripts = enabled;
    }

    pub(crate) fn dependency_alias_map(&self) -> Vec<(String, String)> {
        self.dependency_alias_map_consumed(false).value
    }

    pub(crate) fn dependency_alias_map_observed(
        &self,
    ) -> crate::package_route::stamp::Consumed<Vec<(String, String)>> {
        self.dependency_alias_map_consumed(true)
    }

    fn dependency_alias_map_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<Vec<(String, String)>> {
        use super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let anchored = take(&mut facts, self.resolved_tsconfig_path_consumed(observe));
        let aliases = take(
            &mut facts,
            self.alias_map_of_consumed(anchored.as_deref(), observe),
        );
        if !aliases.is_empty() {
            return finish(facts, aliases);
        }
        // A solution-style shell (create-vue's default) declares nothing
        // itself; the first referenced config that yields paths wins — the
        // standard app/node split has exactly one (#3915).
        let Some(anchored) = anchored else {
            return finish(facts, aliases);
        };
        for referenced in take(
            &mut facts,
            super::super::tsconfig_gen::references::referenced_project_configs_consumed(
                &anchored, observe,
            ),
        ) {
            let referenced_aliases = take(
                &mut facts,
                self.alias_map_of_consumed(Some(&referenced), observe),
            );
            if !referenced_aliases.is_empty() {
                return finish(facts, referenced_aliases);
            }
        }
        finish(facts, aliases)
    }

    fn alias_map_of_consumed(
        &self,
        tsconfig_path: Option<&Path>,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<Vec<(String, String)>> {
        use super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let flattened = if observe {
            match self.load_compiler_options_flattened_observed(tsconfig_path) {
                Ok(consumed) => take(&mut facts, consumed),
                Err(_) => {
                    facts.qualified = false;
                    return finish(facts, Vec::new());
                }
            }
        } else {
            let Ok(flattened) = self.load_compiler_options_flattened(tsconfig_path) else {
                return finish(facts, Vec::new());
            };
            flattened
        };
        let Some(paths) = flattened
            .options
            .get("paths")
            .and_then(serde_json::Value::as_object)
        else {
            return finish(facts, Vec::new());
        };
        let mut aliases = Vec::new();
        for (pattern, targets) in paths {
            let Some(targets) = targets.as_array() else {
                continue;
            };
            for target in targets.iter().filter_map(serde_json::Value::as_str) {
                aliases.push((pattern.clone(), target.to_owned()));
            }
        }
        finish(facts, aliases)
    }
}
