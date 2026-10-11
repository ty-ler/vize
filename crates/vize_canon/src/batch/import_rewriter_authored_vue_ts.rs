//! Distinguishes an authored `.vue.ts` import from an SFC mirror collision.

use std::path::Path;

use crate::package_route::stamp::{Consumed, InputStamp};

use vize_carton::{String, cstr};

use super::virtual_rewrite::append_extension;
use crate::batch::virtual_specifier_message::{
    AUTHORED_VUE_TS_ALIAS_SENTINEL, AUTHORED_VUE_TS_SENTINEL, MISSING_VUE_IMPORT_SENTINEL,
};

pub(super) enum VueTsCollision {
    /// No authored candidate exists; use the child-path poison from #3482.
    Unresolved,
    /// TypeScript has an authored candidate that needs a collision-free alias.
    Authored,
}

/// Whether an explicit `.vue.ts`/`.vue.tsx` specifier shares its virtual path
/// with the generated mirror for a sibling SFC.
fn authored_vue_ts_collides_with_sfc(
    specifier: &str,
    source_dir: Option<&Path>,
    facts: &mut Option<&mut Consumed<()>>,
) -> Option<VueTsCollision> {
    let suffix = if specifier.ends_with(".vue.tsx") {
        ".tsx"
    } else if specifier.ends_with(".vue.ts") {
        ".ts"
    } else {
        return None;
    };

    let relative = specifier.starts_with("./") || specifier.starts_with("../");
    let path = Path::new(specifier);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else if relative {
        let source_dir = source_dir?;
        source_dir.join(path)
    } else {
        // Bare and aliased paths need the project resolver. Absence cannot be
        // established from the authored directory alone.
        return None;
    };

    let name = candidate.file_name().and_then(|name| name.to_str())?;
    let sfc_name = name.strip_suffix(suffix)?;
    let sfc_path = candidate.with_file_name(sfc_name);
    if !consumed_file_predicate(&sfc_path, facts) {
        return None;
    }

    let stripped_extensions: &[&str] = if suffix == ".tsx" {
        &[".tsx", ".ts", ".d.ts", ".jsx", ".js"]
    } else {
        &[".ts", ".tsx", ".d.ts", ".js", ".jsx"]
    };
    let missing = stripped_extensions
        .iter()
        .all(|extension| path_is_proven_absent(&append_extension(&sfc_path, extension), facts))
        && [".ts", ".tsx", ".d.ts", ".js", ".jsx"]
            .iter()
            .all(|extension| {
                path_is_proven_absent(&append_extension(&candidate, extension), facts)
            })
        && path_is_proven_absent(&candidate, facts);
    Some(if missing {
        VueTsCollision::Unresolved
    } else {
        VueTsCollision::Authored
    })
}

pub(super) fn rewrite_authored_or_missing_vue_import(
    specifier: &str,
    source_dir: Option<&Path>,
    preserve_missing_vue_diagnostics: bool,
    include_absolute_missing_vue: bool,
) -> Option<String> {
    rewrite_authored_or_missing_vue_import_inner(
        specifier,
        source_dir,
        preserve_missing_vue_diagnostics,
        include_absolute_missing_vue,
        &mut None,
    )
}

pub(super) fn rewrite_authored_or_missing_vue_import_consumed(
    specifier: &str,
    source_dir: Option<&Path>,
    preserve_missing_vue_diagnostics: bool,
    include_absolute_missing_vue: bool,
    observe: bool,
) -> Consumed<Option<String>> {
    let mut facts = Consumed {
        value: (),
        stamps: Vec::new(),
        qualified: observe,
    };
    let value = rewrite_authored_or_missing_vue_import_inner(
        specifier,
        source_dir,
        preserve_missing_vue_diagnostics,
        include_absolute_missing_vue,
        &mut observe.then_some(&mut facts),
    );
    Consumed {
        value,
        stamps: facts.stamps,
        qualified: facts.qualified,
    }
}

fn rewrite_authored_or_missing_vue_import_inner(
    specifier: &str,
    source_dir: Option<&Path>,
    preserve_missing_vue_diagnostics: bool,
    include_absolute_missing_vue: bool,
    facts: &mut Option<&mut Consumed<()>>,
) -> Option<String> {
    if let Some(collision) = authored_vue_ts_collides_with_sfc(specifier, source_dir, facts) {
        let marker = match collision {
            VueTsCollision::Unresolved => AUTHORED_VUE_TS_SENTINEL,
            VueTsCollision::Authored => AUTHORED_VUE_TS_ALIAS_SENTINEL,
        };
        return Some(cstr!("{specifier}{marker}"));
    }
    if !preserve_missing_vue_diagnostics {
        return None;
    }
    missing_vue_import_is_proven_absent(specifier, source_dir, include_absolute_missing_vue, facts)
        .then(|| cstr!("{specifier}.ts{MISSING_VUE_IMPORT_SENTINEL}"))
}

fn missing_vue_import_is_proven_absent(
    specifier: &str,
    source_dir: Option<&Path>,
    include_absolute: bool,
    facts: &mut Option<&mut Consumed<()>>,
) -> bool {
    if !specifier.ends_with(".vue") {
        return false;
    }

    let relative = specifier.starts_with("./") || specifier.starts_with("../");
    let path = Path::new(specifier);
    let candidate = if path.is_absolute() && include_absolute {
        path.to_path_buf()
    } else if relative {
        let Some(source_dir) = source_dir else {
            return false;
        };
        source_dir.join(path)
    } else {
        return false;
    };

    path_is_proven_absent(&candidate, facts)
        && path_is_proven_absent(&append_extension(&candidate, ".d.ts"), facts)
}

fn path_is_proven_absent(path: &Path, facts: &mut Option<&mut Consumed<()>>) -> bool {
    let result = path.try_exists();
    let absent = matches!(&result, Ok(false));
    if let Some(facts) = facts.as_deref_mut() {
        let result = result.map_err(|error| error.kind());
        facts.qualified &= path.is_absolute() && result.is_ok();
        facts
            .stamps
            .push(InputStamp::observed_try_exists(path.to_path_buf(), result));
    }
    absent
}

pub(super) fn consumed_file_predicate(path: &Path, facts: &mut Option<&mut Consumed<()>>) -> bool {
    let is_file = path.is_file();
    if let Some(facts) = facts.as_deref_mut() {
        facts.qualified &= path.is_absolute();
        facts
            .stamps
            .push(InputStamp::observed_is_file(path.to_path_buf(), is_file));
    }
    is_file
}
