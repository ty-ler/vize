use std::path::{Path, PathBuf};

use crate::package_route::stamp::InputStamp;
use vize_carton::{FxHashMap, cstr};

pub(super) fn probe_candidates_with_inputs_inner(
    base: &Path,
    mut stamps: Option<&mut Vec<InputStamp>>,
    overlays: Option<&FxHashMap<PathBuf, &str>>,
) -> (Option<PathBuf>, Vec<PathBuf>) {
    let mut inputs = vec![base.to_path_buf()];
    let extension = base.extension().and_then(|extension| extension.to_str());
    // TypeScript substitutes type-bearing extensions before consulting the
    // JavaScript runtime file, even when that runtime file exists.
    let extensions: &[&str] = match extension {
        Some("js" | "jsx") => &["ts", "tsx", "d.ts", "js", "jsx"],
        Some("mjs") => &["mts", "d.mts", "mjs"],
        Some("cjs") => &["cts", "d.cts", "cjs"],
        _ if file_predicate(base, &mut stamps, overlays) => {
            return (Some(base.to_path_buf()), inputs);
        }
        Some("vue" | "ts" | "tsx" | "mts" | "cts" | "json") => return (None, inputs),
        _ => &[
            "ts", "tsx", "d.ts", "mts", "d.mts", "cts", "d.cts", "vue", "js", "jsx", "mjs", "cjs",
        ],
    };
    let runtime_extension = matches!(extension, Some("js" | "jsx" | "mjs" | "cjs"));
    let probe_base = if runtime_extension {
        base.with_extension("")
    } else {
        base.to_path_buf()
    };
    for extension in extensions {
        let candidate = PathBuf::from(cstr!("{}.{extension}", probe_base.display()).as_str());
        inputs.push(candidate.clone());
        if file_predicate(&candidate, &mut stamps, overlays) {
            return (Some(candidate), inputs);
        }
    }
    if runtime_extension {
        return (None, inputs);
    }
    for index in [
        "index.ts",
        "index.tsx",
        "index.d.ts",
        "index.mts",
        "index.d.mts",
        "index.cts",
        "index.d.cts",
        "index.vue",
        "index.js",
        "index.jsx",
        "index.mjs",
        "index.cjs",
    ] {
        let candidate = base.join(index);
        inputs.push(candidate.clone());
        if file_predicate(&candidate, &mut stamps, overlays) {
            return (Some(candidate), inputs);
        }
    }
    (None, inputs)
}

fn file_predicate(
    path: &Path,
    stamps: &mut Option<&mut Vec<InputStamp>>,
    overlays: Option<&FxHashMap<PathBuf, &str>>,
) -> bool {
    let is_file = path.is_file();
    if let Some(stamps) = stamps.as_deref_mut() {
        stamps.push(InputStamp::observed_is_file(path.to_path_buf(), is_file));
    }
    if is_file || !overlays.is_some_and(|overlays| overlays.contains_key(path)) {
        return is_file;
    }
    // Only the exact caller-owned buffer can supply an absent source. Keep
    // the actual negative disk predicate; directories and inaccessible paths
    // do not become files merely because a buffer was supplied.
    let exists = path.try_exists().map_err(|error| error.kind());
    if let Some(stamps) = stamps {
        stamps.push(InputStamp::observed_try_exists(path.to_path_buf(), exists));
    }
    exists == Ok(false)
}
