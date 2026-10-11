use super::{Path, PathBuf, SourceFilePolicy, VirtualProject};

impl VirtualProject {
    pub(crate) fn use_effective_tsconfig_for_source(&mut self, source_path: &Path) {
        self.use_effective_tsconfig_for_source_consumed(source_path, false);
    }

    pub(crate) fn use_effective_tsconfig_for_source_observed(
        &mut self,
        source_path: &Path,
    ) -> crate::package_route::stamp::Consumed<()> {
        self.use_effective_tsconfig_for_source_consumed(source_path, true)
    }

    fn use_effective_tsconfig_for_source_consumed(
        &mut self,
        source_path: &Path,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<()> {
        use super::super::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let Some(shell) = take(&mut facts, self.resolved_tsconfig_path_consumed(observe)) else {
            facts.qualified = false;
            return finish(facts, ());
        };
        let effective = take(
            &mut facts,
            super::super::super::tsconfig_gen::references::effective_config_for_source_consumed(
                &shell,
                source_path,
                observe,
            ),
        );
        take(
            &mut facts,
            self.set_tsconfig_path_consumed(Some(effective), observe),
        );
        finish(facts, ())
    }

    /// Set the tsconfig path to extend.
    pub fn set_tsconfig_path(&mut self, tsconfig_path: Option<PathBuf>) {
        self.set_tsconfig_path_consumed(tsconfig_path, false);
    }

    pub(crate) fn set_tsconfig_path_observed(
        &mut self,
        tsconfig_path: Option<PathBuf>,
    ) -> crate::package_route::stamp::Consumed<()> {
        self.set_tsconfig_path_consumed(tsconfig_path, true)
    }

    pub(in super::super::super) fn set_tsconfig_path_consumed(
        &mut self,
        tsconfig_path: Option<PathBuf>,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<()> {
        use super::super::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        self.tsconfig_path = tsconfig_path.map(vize_carton::path::normalize_windows_verbatim_path);
        self.preserve_unused_diagnostics = take(
            &mut facts,
            self.resolve_tsconfig_preserves_unused_diagnostics_consumed(observe),
        );
        self.source_policy = take(
            &mut facts,
            self.resolve_source_file_policy_consumed(observe),
        );
        self.alias_rewrite_policy = take(
            &mut facts,
            self.resolve_alias_rewrite_policy_consumed(observe),
        );
        take(
            &mut facts,
            self.refresh_vue_compiler_options_consumed(observe),
        );
        finish(facts, ())
    }

    pub(in super::super) fn resolve_source_file_policy(&self) -> SourceFilePolicy {
        self.resolve_source_file_policy_consumed(false).value
    }

    pub(in super::super::super) fn resolve_source_file_policy_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<SourceFilePolicy> {
        use super::super::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let Some(tsconfig_path) = take(&mut facts, self.resolved_tsconfig_path_consumed(observe))
        else {
            facts.qualified = false;
            return finish(facts, SourceFilePolicy::default());
        };
        let value = self
            .configuration_options(Some(tsconfig_path.as_path()), observe, &mut facts)
            .as_ref()
            .map(SourceFilePolicy::from_compiler_options)
            .unwrap_or_default();
        finish(facts, value)
    }

    pub(crate) fn set_declaration_roots(&mut self, paths: &[PathBuf]) {
        self.set_declaration_roots_consumed(paths, false);
    }

    pub(crate) fn set_declaration_roots_observed(
        &mut self,
        paths: &[PathBuf],
    ) -> crate::package_route::stamp::Consumed<()> {
        self.set_declaration_roots_consumed(paths, true)
    }

    fn set_declaration_roots_consumed(
        &mut self,
        paths: &[PathBuf],
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<()> {
        use super::super::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let roots = paths
            .iter()
            .filter_map(|path| {
                let is_file = path.is_file();
                if observe {
                    facts
                        .stamps
                        .push(crate::package_route::stamp::InputStamp::observed_is_file(
                            path.clone(),
                            is_file,
                        ));
                    facts.qualified &= path.is_absolute();
                }
                is_file.then(|| {
                    take(
                        &mut facts,
                        Self::canonical_configuration_path(path, observe),
                    )
                })
            })
            .collect();
        if self.declaration_roots.as_ref() != Some(&roots) {
            self.mark_incremental_config_file();
        }
        self.declaration_roots = Some(roots);
        finish(facts, ())
    }
}
