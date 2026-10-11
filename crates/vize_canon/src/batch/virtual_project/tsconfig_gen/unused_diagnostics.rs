use super::{VirtualProject, compiler_option_enabled};

impl VirtualProject {
    pub(in super::super) fn resolve_tsconfig_preserves_unused_diagnostics(&self) -> bool {
        self.resolve_tsconfig_preserves_unused_diagnostics_consumed(false)
            .value
    }

    pub(in super::super) fn resolve_tsconfig_preserves_unused_diagnostics_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<bool> {
        use super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let Some(tsconfig_path) = take(&mut facts, self.resolved_tsconfig_path_consumed(observe))
        else {
            facts.qualified = false;
            return finish(facts, false);
        };
        let Some(compiler_options) =
            self.configuration_options(Some(tsconfig_path.as_path()), observe, &mut facts)
        else {
            return finish(facts, false);
        };

        finish(
            facts,
            compiler_option_enabled(&compiler_options, "noUnusedLocals")
                || compiler_option_enabled(&compiler_options, "noUnusedParameters"),
        )
    }
}
