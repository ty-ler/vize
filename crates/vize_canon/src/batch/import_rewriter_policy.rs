//! Import-specifier rewrite policy shared by batch and editor paths.

use std::path::Path;

use crate::package_route::stamp::Consumed;

use vize_carton::{String, cstr};

use super::{
    ImportRewriter, VirtualAliasRewritePolicy,
    authored_vue_ts::{
        rewrite_authored_or_missing_vue_import, rewrite_authored_or_missing_vue_import_consumed,
    },
    virtual_rewrite::is_rewritable_vue_specifier,
};

impl ImportRewriter {
    pub(crate) fn rewrite_module_specifier_with_missing_vue_policy_and_alias_policy(
        &self,
        path: &str,
        source_dir: Option<&Path>,
        preserve_missing_vue_diagnostics: bool,
        include_absolute_missing_vue: bool,
        alias_rewrite_policy: Option<&VirtualAliasRewritePolicy>,
    ) -> Option<String> {
        self.rewrite_module_specifier_with_missing_vue_policy_consumed(
            path,
            source_dir,
            preserve_missing_vue_diagnostics,
            include_absolute_missing_vue,
            alias_rewrite_policy,
            false,
        )
        .value
    }

    pub(crate) fn rewrite_module_specifier_with_missing_vue_policy_consumed(
        &self,
        path: &str,
        source_dir: Option<&Path>,
        preserve_missing_vue_diagnostics: bool,
        include_absolute_missing_vue: bool,
        alias_rewrite_policy: Option<&VirtualAliasRewritePolicy>,
        observe: bool,
    ) -> Consumed<Option<String>> {
        let consumed = if observe {
            rewrite_authored_or_missing_vue_import_consumed(
                path,
                source_dir,
                preserve_missing_vue_diagnostics,
                include_absolute_missing_vue,
                true,
            )
        } else {
            Consumed {
                value: rewrite_authored_or_missing_vue_import(
                    path,
                    source_dir,
                    preserve_missing_vue_diagnostics,
                    include_absolute_missing_vue,
                ),
                stamps: Vec::new(),
                qualified: false,
            }
        };
        if consumed.value.is_some() {
            return consumed;
        }
        let value = if is_rewritable_vue_specifier(path)
            && alias_rewrite_policy.is_none_or(|policy| policy.should_rewrite_vue_specifier(path))
        {
            Some(cstr!("{path}.ts"))
        } else {
            None
        };
        Consumed {
            value,
            stamps: consumed.stamps,
            qualified: consumed.qualified,
        }
    }
}
