//! Unobserved original builder retained as the compatibility test oracle.

use super::{
    AliasContext, CorsaBridgeError, FxHashMap, HostSource, Path, PathBuf, SourceRevision,
    build_consumed,
};

pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn build(
    source_path: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    revision: SourceRevision<'_>,
    resolver: &mut crate::PackageRouteResolver,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
) -> Result<AliasContext, CorsaBridgeError> {
    build_consumed(
        HostSource {
            path: source_path,
            content,
        },
        overlays,
        revision,
        resolver,
        options,
        environment,
        false,
    )
    .map(|consumed| consumed.value)
}
