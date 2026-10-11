//! `VirtualProject` lifecycle: construction, configuration, and file
//! registration. Registration delegates the expensive per-file work to
//! [`super::build`] so it can run in parallel, then absorbs the results into
//! the project's indexes.

use std::path::{Path, PathBuf};

use oxc_span::SourceType;
use rayon::prelude::*;
use vize_carton::{FxHashSet, profile};

use crate::batch::error::{CorsaError, CorsaResult};

mod artifacts;
mod config;
pub(super) mod consumption;
mod package_routes;

use super::VirtualProject;
use super::build::{
    RegisteredFile, ScriptBuildContext, VirtualBuildContext, build_registered_file,
    build_script_registered_file, build_vue_registered_file, source_type_for_path,
};
use super::setup_props::RuntimePropResolveCache;

mod construction;

mod registration;

impl VirtualProject {
    /// Register a supported file path.
    pub(super) fn rewriter(&self) -> &crate::batch::import_rewriter::ImportRewriter {
        &self.rewriter
    }

    /// Register a `.vue` file.
    pub fn register_vue_file(&mut self, path: &Path, content: &str) -> CorsaResult<()> {
        let registered = build_vue_registered_file(
            path,
            content,
            VirtualBuildContext {
                project_root: &self.project_root,
                virtual_root: &self.virtual_root,
                virtual_ts_options: &self.virtual_ts_options,
                virtual_ts_check_options: self.virtual_ts_check_options,
                typed_router_root: self.typed_router.root.as_deref(),
                preserve_unused_diagnostics: self.tsconfig_preserves_unused_diagnostics(),
                options_api: self.options_api,
                legacy_vue2: self.legacy_vue2,
                jsx_typecheck: self.jsx_typecheck,
                dialect: self.dialect,
                template_syntax: self.template_syntax,
                experimental_in_tag_comments: self.experimental_in_tag_comments,
                experimental_patterned_template: self.experimental_patterned_template,
                experimental_strict_slot_children: self.experimental_strict_slot_children,
                hoist_shared_preamble: self.editor_document_options.is_none(),
                editor_document_options: self.editor_document_options,
                preserve_relative_declarations: self.is_package_route_path(path)
                    || self.session_scripts,
                preserve_declaration_spelling: self.session_scripts,
                mirrorable_project_files: None,
                rewriter: &self.rewriter,
                alias_rewrite_policy: Some(self.alias_rewrite_policy()),
                runtime_prop_resolve_cache: None,
            },
        )?;
        self.absorb_registered_file(registered);
        Ok(())
    }

    /// Register a `.ts`/`.tsx`/`.mts`/`.cts` file.
    pub fn register_ts_file(&mut self, path: &Path) -> CorsaResult<()> {
        let content = std::fs::read_to_string(path)?;
        let source_type = source_type_for_path(path).ok_or_else(|| CorsaError::PathError {
            path: path.to_path_buf(),
        })?;
        self.register_script_file(path, &content, source_type)
    }

    /// Register a `.d.ts` file.
    pub fn register_declaration_file(&mut self, path: &Path, content: &str) -> CorsaResult<()> {
        self.register_script_file(path, content, SourceType::ts())
    }

    /// Register a non-Vue source file.
    pub fn register_script_file(
        &mut self,
        path: &Path,
        content: &str,
        source_type: SourceType,
    ) -> CorsaResult<()> {
        let registered = build_script_registered_file(
            path,
            content,
            source_type,
            ScriptBuildContext {
                roots: (&self.project_root, &self.virtual_root),
                rewriter: &self.rewriter,
                preserve_relative_declarations: self.is_package_route_path(path)
                    || self.session_scripts,
                preserve_declaration_spelling: self.session_scripts,
                mirrorable_project_files: None,
                alias_rewrite_policy: Some(self.alias_rewrite_policy()),
            },
        )?;
        self.absorb_registered_file(registered);
        Ok(())
    }
}

#[cfg(test)]
mod consumed_configuration_tests;
