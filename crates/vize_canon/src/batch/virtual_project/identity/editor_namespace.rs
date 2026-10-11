use super::{
    Digest, PROJECT_CONTEXT_KEY_SCHEMA, PROJECTS_DIR, Path, PathBuf, Sha256, encode_digest,
    update_path_digest,
};

/// Return a namespace shared only by editor snapshots with the same effective
/// config and generation options. A solution shell may own multiple referenced
/// projects whose compiler options are intentionally incompatible; they must
/// never overwrite one mirror `tsconfig.json` merely because their source tree
/// has the same root.
pub(in crate::batch::virtual_project) fn project_virtual_root_with_identity(
    storage_root: &Path,
    project_root: &Path,
    identity: u64,
) -> PathBuf {
    project_virtual_root_with_identity_consumed(storage_root, project_root, identity, false).value
}

/// Observe only the identity actually returned by this original namespace operation.
pub(in crate::batch::virtual_project) fn project_virtual_root_with_identity_observed(
    storage_root: &Path,
    project_root: &Path,
    identity: u64,
) -> crate::package_route::stamp::Consumed<PathBuf> {
    project_virtual_root_with_identity_consumed(storage_root, project_root, identity, true)
}

fn project_virtual_root_with_identity_consumed(
    storage_root: &Path,
    project_root: &Path,
    identity: u64,
    observe: bool,
) -> crate::package_route::stamp::Consumed<PathBuf> {
    use crate::package_route::stamp::{Consumed, InputStamp};
    let mut facts = Consumed {
        value: (),
        stamps: Vec::new(),
        qualified: observe,
    };
    let original_project_root = project_root;
    let project_root = vize_carton::path::canonicalize_non_verbatim(project_root);
    if observe {
        facts.qualified &= original_project_root.is_absolute() && project_root.is_absolute();
        facts.stamps.push(InputStamp::observed_canonical_path(
            original_project_root.to_path_buf(),
            project_root.clone(),
        ));
    }
    let mut digest = Sha256::new();
    digest.update(PROJECT_CONTEXT_KEY_SCHEMA);
    update_path_digest(&mut digest, &project_root);
    digest.update(identity.to_le_bytes());
    let project_key = encode_digest(digest.finalize());
    // TypeScript's editor project service classifies every path below a
    // `node_modules` segment as an external library. The bridge supplies a
    // session-private temp root so unsaved overlay bytes never cross native
    // project lifetimes; this digest scopes incompatible configs inside it.
    let selected_storage = vize_carton::path::canonicalize_non_verbatim(storage_root);
    if observe {
        facts.qualified &= storage_root.is_absolute() && selected_storage.is_absolute();
        facts.stamps.push(InputStamp::observed_canonical_path(
            storage_root.to_path_buf(),
            selected_storage.clone(),
        ));
    }
    let value = selected_storage
        .join(PROJECTS_DIR)
        .join(project_key.as_str());
    Consumed {
        value,
        stamps: facts.stamps,
        qualified: facts.qualified,
    }
}

#[cfg(test)]
mod tests;
