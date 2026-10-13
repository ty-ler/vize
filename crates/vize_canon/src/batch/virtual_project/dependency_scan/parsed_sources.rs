//! Pure Oxc outputs retained only during one existing cold graph operation.
use std::path::{Path, PathBuf};

use oxc_span::SourceType;
use vize_carton::{FxHashMap, String};

use crate::{PackageResolutionMode, batch::ImportRewriter};

struct ParsedSource {
    source: String,
    source_type: SourceType,
    occurrences: Vec<(String, PackageResolutionMode)>,
}

/// Exact projection bytes and syntax own this derived packet. It grants no
/// filesystem, configuration, route, resolver or dependency-edge authority.
#[derive(Default)]
pub(crate) struct ParsedDependencySources {
    sources: FxHashMap<PathBuf, ParsedSource>,
    #[cfg(test)]
    parses: usize,
    #[cfg(test)]
    hits: usize,
}

impl ParsedDependencySources {
    /// Borrow only the packet for the exact projection and syntax supplied now.
    /// A miss neither parses nor retains another source and grants no authority.
    pub(crate) fn current_occurrences(
        &self,
        path: &Path,
        source: &str,
        source_type: SourceType,
    ) -> Option<&[(String, PackageResolutionMode)]> {
        let entry = self.sources.get(path)?;
        (entry.source_type == source_type && entry.source.as_str() == source)
            .then_some(entry.occurrences.as_slice())
    }

    pub(crate) fn occurrences(
        &mut self,
        rewriter: &ImportRewriter,
        path: &Path,
        source: &str,
        source_type: SourceType,
    ) -> Vec<(String, PackageResolutionMode)> {
        let entry = self.sources.entry(path.to_path_buf());
        if let std::collections::hash_map::Entry::Occupied(entry) = &entry
            && entry.get().source_type == source_type
            && entry.get().source.as_str() == source
        {
            #[cfg(test)]
            {
                self.hits += 1;
            }
            return entry.get().occurrences.clone();
        }
        let occurrences = rewriter.collect_all_specifier_occurrences(source, source_type);
        #[cfg(test)]
        {
            self.parses += 1;
        }
        entry.insert_entry(ParsedSource {
            // Only a retained miss needs its own complete source bytes.
            source: source.into(),
            source_type,
            occurrences: occurrences.clone(),
        });
        occurrences
    }
}

#[cfg(test)]
mod tests;
