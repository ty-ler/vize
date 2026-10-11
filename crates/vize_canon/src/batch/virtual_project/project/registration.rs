use super::{
    CorsaError, CorsaResult, FxHashSet, Path, PathBuf, RegisteredFile, RuntimePropResolveCache,
    VirtualBuildContext, VirtualProject, build_registered_file, profile,
};
use crate::batch::virtual_project::package_source_index::{empty, finish, take};
use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use rayon::prelude::{IntoParallelRefIterator, ParallelIterator};

mod inferred;

impl VirtualProject {
    #[cfg(test)]
    pub(crate) fn register_path_observed(&mut self, path: &Path) -> CorsaResult<Consumed<()>> {
        let mut facts = empty(true);
        self.register_path_with_consumption(path, true, &mut facts)?;
        Ok(finish(facts, ()))
    }

    pub(crate) fn register_path_with_content_observed(
        &mut self,
        path: &Path,
        content: &str,
    ) -> CorsaResult<Consumed<()>> {
        let mut facts = empty(true);
        Self::observe_registered_source(path, content, true, &mut facts);
        self.register_path_with_content_with_consumption(path, content, true, &mut facts)?;
        Ok(finish(facts, ()))
    }

    /// The value is the package classification actually consumed by this build.
    pub(crate) fn register_path_with_package_generation_observed(
        &mut self,
        path: &Path,
        content: &str,
    ) -> CorsaResult<Consumed<bool>> {
        let mut facts = empty(true);
        Self::observe_registered_source(path, content, true, &mut facts);
        let package =
            self.register_path_with_content_with_consumption(path, content, true, &mut facts)?;
        Ok(finish(facts, package))
    }

    #[cfg(test)]
    pub(crate) fn register_paths_observed(
        &mut self,
        paths: &[PathBuf],
    ) -> CorsaResult<Consumed<()>> {
        let mut facts = empty(true);
        self.register_paths_with_consumption(paths, true, &mut facts)?;
        Ok(finish(facts, ()))
    }

    pub fn register_path(&mut self, path: &Path) -> CorsaResult<()> {
        let mut facts = empty(false);
        self.register_path_with_consumption(path, false, &mut facts)
    }

    pub(in crate::batch::virtual_project) fn register_path_with_consumption(
        &mut self,
        path: &Path,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> CorsaResult<()> {
        let content = profile!("canon.file.read", std::fs::read_to_string(path))?;
        Self::observe_registered_source(path, &content, observe, facts);
        self.register_path_with_content_with_consumption(path, &content, observe, facts)
            .map(|_| ())
    }

    /// Register a supported file path with already-loaded content.
    pub fn register_path_with_content(&mut self, path: &Path, content: &str) -> CorsaResult<()> {
        let mut facts = empty(false);
        self.register_path_with_content_with_consumption(path, content, false, &mut facts)
            .map(|_| ())
    }

    pub(in crate::batch::virtual_project) fn register_path_with_content_with_consumption(
        &mut self,
        path: &Path,
        content: &str,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> CorsaResult<bool> {
        let package_route_path = self.is_package_route_path(path);
        let registered = build_registered_file(
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
                preserve_relative_declarations: package_route_path || self.session_scripts,
                preserve_declaration_spelling: self.session_scripts,
                mirrorable_project_files: None,
                rewriter: &self.rewriter,
                alias_rewrite_policy: Some(self.alias_rewrite_policy()),
                runtime_prop_resolve_cache: None,
            },
        )?;
        self.absorb_registered_file_with_consumption(registered, observe, facts);
        Ok(package_route_path)
    }

    /// Register a batch of file paths, parallelizing per-file parse and Virtual TS
    /// generation across rayon's thread pool. Falls back to sequential work when
    /// the batch is small enough that the fan-out cost would dominate.
    ///
    /// This is deliberately structured as "parallel build, sequential absorb".
    /// `build_registered_file` owns the expensive work (disk read, SFC parse,
    /// template parse, virtual-TS generation, import rewriting) and only needs an
    /// immutable build context, so it scales cleanly across rayon workers. The
    /// mutable project indexes are updated after the join point, which preserves
    /// deterministic maps and avoids locking every insertion in the hot loop.
    pub fn register_paths(&mut self, paths: &[PathBuf]) -> CorsaResult<()> {
        let mut facts = empty(false);
        self.register_paths_with_consumption(paths, false, &mut facts)
    }

    pub(in crate::batch::virtual_project) fn register_paths_with_consumption(
        &mut self,
        paths: &[PathBuf],
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> CorsaResult<()> {
        let valid_paths: Vec<&Path> = paths
            .iter()
            .filter(|path| {
                let is_file = path.is_file();
                if observe {
                    facts.qualified &= path.is_absolute();
                    let owner = Shared::new(FactOwner {
                        path: path.to_path_buf(),
                        role: FactRole::AuthoredSource,
                    });
                    facts.stamps.push(
                        InputStamp::observed_is_file(path.to_path_buf(), is_file).with_owner(owner),
                    );
                }
                is_file
            })
            .map(PathBuf::as_path)
            .collect();
        if valid_paths.is_empty() {
            return Ok(());
        }

        // Sequential is cheaper for tiny batches than firing up rayon workers.
        if valid_paths.len() <= 1 {
            for path in valid_paths {
                self.register_path_with_consumption(path, observe, facts)?;
            }
            return Ok(());
        }

        let preserve_unused_diagnostics = self.tsconfig_preserves_unused_diagnostics();
        let runtime_prop_resolve_cache = RuntimePropResolveCache::default();
        let mut mirrorable_project_files: FxHashSet<PathBuf> = valid_paths
            .iter()
            .map(|path| {
                Self::root_owner_canonical(
                    path,
                    Some((path, FactRole::AuthoredSource)),
                    observe,
                    facts,
                )
            })
            .collect();
        mirrorable_project_files.extend(self.original_index.keys().cloned());
        let build_context = VirtualBuildContext {
            project_root: self.project_root.as_path(),
            virtual_root: self.virtual_root.as_path(),
            virtual_ts_options: &self.virtual_ts_options,
            virtual_ts_check_options: self.virtual_ts_check_options,
            typed_router_root: self.typed_router.root.as_deref(),
            preserve_unused_diagnostics,
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
            preserve_relative_declarations: self.session_scripts,
            preserve_declaration_spelling: self.session_scripts,
            mirrorable_project_files: Some(&mirrorable_project_files),
            rewriter: &self.rewriter,
            alias_rewrite_policy: Some(self.alias_rewrite_policy()),
            runtime_prop_resolve_cache: Some(&runtime_prop_resolve_cache),
        };
        let package_paths = self
            .package_routes
            .values()
            .filter_map(|binding| binding.route.as_ref())
            .flat_map(|route| route.all_source_paths().into_iter().cloned())
            .collect::<FxHashSet<_>>();

        let registered: Result<Vec<Consumed<RegisteredFile>>, CorsaError> = valid_paths
            .par_iter()
            .map(|&path| {
                let content = profile!("canon.file.read", std::fs::read_to_string(path))?;
                let mut context = build_context;
                context.preserve_relative_declarations =
                    package_paths.contains(path) || self.session_scripts;
                let registered = build_registered_file(path, &content, context)?;
                let mut child = empty(observe);
                Self::observe_registered_source(path, &content, observe, &mut child);
                Ok(finish(child, registered))
            })
            .collect();

        self.virtual_files.reserve(valid_paths.len());
        for registered in registered? {
            let registered = take(facts, registered);
            self.absorb_registered_file_with_consumption(registered, observe, facts);
        }
        Ok(())
    }
}
