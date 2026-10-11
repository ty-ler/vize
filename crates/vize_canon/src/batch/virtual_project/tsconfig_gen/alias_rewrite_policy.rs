use serde_json::Value;

use crate::batch::import_rewriter::VirtualAliasRewritePolicy;

use super::VirtualProject;

impl VirtualProject {
    pub(in crate::batch::virtual_project) fn alias_rewrite_policy(
        &self,
    ) -> &VirtualAliasRewritePolicy {
        &self.alias_rewrite_policy
    }

    pub(in crate::batch::virtual_project) fn resolve_alias_rewrite_policy(
        &self,
    ) -> VirtualAliasRewritePolicy {
        self.resolve_alias_rewrite_policy_consumed(false).value
    }

    pub(in crate::batch::virtual_project) fn resolve_alias_rewrite_policy_consumed(
        &self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<VirtualAliasRewritePolicy> {
        use super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let path = take(&mut facts, self.resolved_tsconfig_path_consumed(observe));
        let Some(compiler_options) =
            self.configuration_options(path.as_deref(), observe, &mut facts)
        else {
            return finish(facts, VirtualAliasRewritePolicy::default());
        };
        finish(
            facts,
            compiler_options
                .get("paths")
                .and_then(Value::as_object)
                .map(VirtualAliasRewritePolicy::from_paths)
                .unwrap_or_default(),
        )
    }
}
