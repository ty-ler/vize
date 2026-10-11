//! The same effective settings and namespace for cold and reused mirrors.

use std::path::Path;

use crate::batch::virtual_project::VirtualProject;
use crate::corsa_bridge::types::CorsaBridgeError;

pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn configured_project(
    source_path: &Path,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
) -> Result<VirtualProject, CorsaBridgeError> {
    configured_project_consumed(source_path, options, environment, false)
        .map(|consumed| consumed.value)
}

pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn configured_project_observed(
    source_path: &Path,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
) -> Result<
    crate::package_route::stamp::Consumed<crate::batch::virtual_project::VirtualProject>,
    CorsaBridgeError,
> {
    configured_project_consumed(source_path, options, environment, true)
}

fn configured_project_consumed(
    source_path: &Path,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
    observe: bool,
) -> Result<
    crate::package_route::stamp::Consumed<crate::batch::virtual_project::VirtualProject>,
    CorsaBridgeError,
> {
    use crate::package_route::stamp::{Consumed, InputStamp};
    let mut facts = Consumed {
        value: (),
        stamps: Vec::new(),
        qualified: observe,
    };
    let discovered_config = source_path.ancestors().skip(1).find_map(|dir| {
        ["tsconfig.json", "jsconfig.json"]
            .into_iter()
            .map(|name| dir.join(name))
            .find(|path| {
                let is_file = path.is_file();
                if observe {
                    facts
                        .stamps
                        .push(InputStamp::observed_is_file(path.clone(), is_file));
                }
                is_file
            })
    });
    let root = environment
        .project_root
        .map(Path::to_path_buf)
        .or_else(|| {
            discovered_config
                .as_deref()
                .and_then(Path::parent)
                .map(Path::to_path_buf)
        })
        .unwrap_or_else(|| source_path.parent().unwrap_or(source_path).to_path_buf());
    let root = VirtualProject::consume_configuration(
        &mut facts,
        VirtualProject::canonical_configuration_path(&root, observe),
    );
    let configured_tsconfig = environment.tsconfig_path.map(|path| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        }
    });

    let mut project = if observe {
        VirtualProject::consume_configuration(
            &mut facts,
            VirtualProject::new_configuration_observed(&root).map_err(super::bridge_error)?,
        )
    } else {
        VirtualProject::new(&root).map_err(super::bridge_error)?
    };
    project.set_virtual_ts_options(environment.virtual_ts_options.clone());
    project.set_options_api(options.options_api);
    project.set_legacy_vue2(options.legacy_vue2);
    project.set_jsx_typecheck(options.jsx_typecheck);
    project.set_experimental_patterned_template(options.experimental_patterned_template);
    project.set_dialect(options.dialect);
    // The workspace root selects the mirror's filesystem scope, not the
    // compiler options for every package beneath it. Anchor the source to its
    // nearest config before resolving a solution-style project's references.
    if let Some(tsconfig) = configured_tsconfig.or(discovered_config) {
        if observe {
            VirtualProject::consume_configuration(
                &mut facts,
                project.set_tsconfig_path_observed(Some(tsconfig)),
            );
        } else {
            project.set_tsconfig_path(Some(tsconfig));
        }
    }
    if observe {
        VirtualProject::consume_configuration(
            &mut facts,
            project.use_effective_tsconfig_for_source_observed(source_path),
        );
    } else {
        project.use_effective_tsconfig_for_source(source_path);
    }
    let effective = if observe {
        VirtualProject::consume_configuration(&mut facts, project.resolved_tsconfig_path_observed())
    } else {
        project.effective_tsconfig_path()
    };
    let namespace_identity = super::super::namespace::editor_namespace_identity(
        options,
        environment.virtual_ts_options,
        Some(&root),
        effective.as_deref(),
    );
    if observe {
        VirtualProject::consume_configuration(
            &mut facts,
            project.scope_editor_namespace_observed(
                environment.editor_session.root()?,
                namespace_identity,
            ),
        );
    } else {
        project.scope_editor_namespace(environment.editor_session.root()?, namespace_identity);
    }
    project.set_session_script_registration(true);
    project.set_editor_document_options(
        crate::batch::virtual_project::VueDocumentVirtualTsOptions {
            options_api: options.options_api,
            legacy_vue2: options.legacy_vue2,
            experimental_patterned_template: options.experimental_patterned_template,
            preserve_event_navigation: options.preserve_event_navigation,
            dialect: options.dialect,
            preserve_missing_vue_diagnostics: true,
        },
    );
    // The native editor queries this one importer. Reachable declarations must
    // be mirrored so user `paths` and relative declaration barrels resolve from
    // the session-private root, but they must stay inferred modules rather than
    // ambient program roots.
    if observe {
        VirtualProject::consume_configuration(
            &mut facts,
            project.set_declaration_roots_observed(&[source_path.to_path_buf()]),
        );
    } else {
        project.set_declaration_roots(&[source_path.to_path_buf()]);
    }
    project.set_package_route_resolver(environment.package_routes.clone());
    // Configuration inputs and the actual final namespace only. Native graph,
    // source/member/host/overlay ownership is earned by the enclosing caller.
    Ok(Consumed {
        value: project,
        stamps: facts.stamps,
        qualified: facts.qualified,
    })
}

#[cfg(test)]
mod tests;
