use super::{PathBuf, VirtualProject};

impl VirtualProject {
    pub(in super::super) fn resolved_tsconfig_path(&self) -> Option<PathBuf> {
        self.resolved_tsconfig_path_consumed(false).value
    }

    pub(crate) fn resolved_tsconfig_path_observed(
        &self,
    ) -> crate::package_route::stamp::Consumed<Option<PathBuf>> {
        self.resolved_tsconfig_path_consumed(true)
    }

    pub(in super::super) fn resolved_tsconfig_path_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<Option<PathBuf>> {
        use super::super::project::consumption::{empty, finish};
        let mut facts = empty(observe);
        if let Some(ref tsconfig_path) = self.tsconfig_path {
            facts.qualified &= tsconfig_path.is_absolute();
            return finish(facts, Some(tsconfig_path.clone()));
        }

        let tsconfig = self.project_root.join("tsconfig.json");
        let exists = tsconfig.exists();
        if observe {
            facts
                .stamps
                .push(crate::package_route::stamp::InputStamp::observed_exists(
                    tsconfig.clone(),
                    exists,
                ));
        }
        facts.qualified &= self.project_root.is_absolute();
        finish(facts, exists.then_some(tsconfig))
    }

    /// The configs whose contents govern this project's alias map: the
    /// anchored tsconfig plus, for a solution-style shell, everything it
    /// references (#3923 cache invalidation).
    pub(crate) fn governing_config_paths(&self) -> Vec<PathBuf> {
        self.governing_config_paths_consumed(false).value
    }

    pub(in super::super) fn governing_config_paths_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<Vec<PathBuf>> {
        use super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let Some(anchored) = take(&mut facts, self.resolved_tsconfig_path_consumed(observe)) else {
            facts.qualified = false;
            return finish(facts, Vec::new());
        };
        let mut config_roots = vec![anchored.clone()];
        config_roots.extend(take(
            &mut facts,
            super::super::tsconfig_gen::references::referenced_project_configs_consumed(
                &anchored, observe,
            ),
        ));
        let mut paths = config_roots.clone();
        for config in config_roots {
            if observe {
                match self.load_compiler_options_flattened_observed(Some(&config)) {
                    Ok(consumed) => paths.extend(take(&mut facts, consumed).input_paths),
                    Err(_) => facts.qualified = false,
                }
            } else if let Ok(flattened) = self.load_compiler_options_flattened(Some(&config)) {
                paths.extend(flattened.input_paths);
            }
        }
        paths.sort();
        paths.dedup();
        finish(facts, paths)
    }
}
