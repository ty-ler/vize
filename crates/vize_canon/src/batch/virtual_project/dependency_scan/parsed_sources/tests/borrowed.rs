//! Literal original owned-input control for the pure parser packet carrier.

use super::super::{FxHashMap, ImportRewriter, ParsedDependencySources, ParsedSource, PathBuf};
use super::{Path, SourceType};
use crate::PackageResolutionMode;
use vize_carton::String;

#[derive(Default)]
struct OriginalOwnedSources {
    sources: FxHashMap<PathBuf, ParsedSource>,
    parses: usize,
    hits: usize,
}

impl OriginalOwnedSources {
    // Keep the original complete owned-source comparison and insertion body.
    fn occurrences(
        &mut self,
        rewriter: &ImportRewriter,
        path: &Path,
        source: String,
        source_type: SourceType,
    ) -> Vec<(String, PackageResolutionMode)> {
        let entry = self.sources.entry(path.to_path_buf());
        if let std::collections::hash_map::Entry::Occupied(entry) = &entry
            && entry.get().source_type == source_type
            && entry.get().source == source
        {
            self.hits += 1;
            return entry.get().occurrences.clone();
        }
        let occurrences = rewriter.collect_all_specifier_occurrences(&source, source_type);
        self.parses += 1;
        entry.insert_entry(ParsedSource {
            source,
            source_type,
            occurrences: occurrences.clone(),
        });
        occurrences
    }
}

fn whole_cache(original: &OriginalOwnedSources, candidate: &ParsedDependencySources) {
    let ParsedDependencySources {
        sources,
        parses,
        hits,
    } = candidate;
    assert_eq!(original.parses, *parses);
    assert_eq!(original.hits, *hits);
    assert_eq!(original.sources.len(), sources.len());
    for (path, before) in &original.sources {
        let ParsedSource {
            source,
            source_type,
            occurrences,
        } = before;
        let after = sources.get(path).unwrap();
        assert_eq!(*source, after.source);
        assert_eq!(*source_type, after.source_type);
        assert_eq!(*occurrences, after.occurrences);
    }
}

#[test]
fn borrowed_packets_keep_the_literal_owned_cache_and_hit_source_owner() {
    let rewriter = ImportRewriter::new();
    let path = Path::new("/current/Projection.vue.ts");
    let other = Path::new("/current/Other.vue.ts");
    let before = "import './alpha'; import './alpha'; const x = require('./alpha'); export * from './child'; // 😀";
    let after = "import './bravo'; import './bravo'; const x = require('./bravo'); export * from './child'; // 😀";
    let jsx = "const x = <Widget value={import('./child')} />; type T = import('types', { with: { 'resolution-mode': 'require' } });";
    let broken = "import x from './broken'const y = ; import('./later'); export {};";
    assert_eq!(before.len(), after.len());
    let mut original = OriginalOwnedSources::default();
    let mut candidate = ParsedDependencySources::default();
    for (path, source, source_type) in [
        (path, before, SourceType::ts()),
        (path, before, SourceType::ts()),
        (path, after, SourceType::ts()),
        (path, after, SourceType::tsx()),
        (path, after, SourceType::tsx()),
        (path, jsx, SourceType::tsx()),
        (path, jsx, SourceType::ts()),
        (path, broken, SourceType::ts()),
        (path, broken, SourceType::ts()),
        (path, before, SourceType::ts()),
        (other, before, SourceType::ts()),
        (other, before, SourceType::ts()),
    ] {
        assert!(source.len() > std::mem::size_of::<String>());
        let caller_source = String::from(source);
        let old_owner = original.sources.get(path).and_then(|entry| {
            (entry.source == source && entry.source_type == source_type)
                .then(|| entry.source.as_ptr())
        });
        let new_owner = candidate.sources.get(path).and_then(|entry| {
            (entry.source == source && entry.source_type == source_type)
                .then(|| entry.source.as_ptr())
        });
        let expected = original.occurrences(&rewriter, path, caller_source.clone(), source_type);
        let actual = candidate.occurrences(&rewriter, path, &caller_source, source_type);
        assert_eq!(expected, actual);
        if let Some(owner) = old_owner {
            assert_eq!(owner, original.sources.get(path).unwrap().source.as_ptr());
        }
        if let Some(owner) = new_owner {
            assert_eq!(owner, candidate.sources.get(path).unwrap().source.as_ptr());
        }
        // Every fixture exceeds inline storage: retained misses own their
        // bytes, and hits keep that same owner rather than replacing it with
        // the distinct currently borrowed caller buffer.
        assert_ne!(
            candidate.sources.get(path).unwrap().source.as_ptr(),
            caller_source.as_ptr(),
        );
        drop(caller_source);
        whole_cache(&original, &candidate);
    }
    assert!(candidate.hits > 0);
}

#[test]
fn retained_miss_owns_bytes_after_the_borrowed_caller_changes_and_drops() {
    let rewriter = ImportRewriter::new();
    let path = Path::new("/current/Projection.vue.ts");
    let mut caller = String::from("import './original'; import './original'; export {};");
    let expected = rewriter.collect_all_specifier_occurrences(&caller, SourceType::ts());
    let mut candidate = ParsedDependencySources::default();
    assert_eq!(
        candidate.occurrences(&rewriter, path, &caller, SourceType::ts()),
        expected,
    );
    let retained_owner = candidate.sources.get(path).unwrap().source.as_ptr();
    caller.clear();
    caller.push_str("import './changed'; export {};");
    assert_eq!(
        candidate.sources.get(path).unwrap().source,
        "import './original'; import './original'; export {};",
    );
    drop(caller);
    assert_eq!(
        candidate.sources.get(path).unwrap().source.as_ptr(),
        retained_owner
    );
    assert_eq!(candidate.sources.get(path).unwrap().occurrences, expected);
}
