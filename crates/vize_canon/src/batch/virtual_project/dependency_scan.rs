//! Reachability registration for out-of-root workspace `.vue` files (#3887).
//!
//! Walk scanned roots to a fixpoint, registering reachable first-party Vue
//! files and script barrels (#3887). Canonical `node_modules` targets retain
//! the ambient stub (#3282); workspace symlinks outside it are first-party.
//! Batch leaves declarations to tsconfig; editor sessions mirror reachable
//! declarations with authored spelling and inferred ownership (see
//! [`is_declaration_file`]).
//!
//! Collect specifiers from valid generated TS and resolve them relative to
//! the original file, folding `.vue.ts` back to `.vue`. Relative imports and
//! tsconfig `paths` aliases are resolved; bare workspace packages require aliases.

use std::path::{Path, PathBuf};

use oxc_span::SourceType;
#[cfg(test)]
use vize_carton::cstr;
use vize_carton::{FxHashMap, FxHashSet, String as CompactString};

use crate::batch::error::CorsaResult;

use super::VirtualProject;

mod aliases;
mod consumption;
use consumption::DependencyConsumption;
mod facade;
mod observed;
mod package_roots;
#[path = "dependency_scan/references.rs"]
mod references;
#[path = "dependency_scan/resolution.rs"]
mod resolution;
#[cfg(test)]
use resolution::{alias_may_reach_first_party, probe_candidates};
use resolution::{inside_node_modules, is_declaration_file, may_resolve_a_dependency};
pub(crate) use resolution::{
    resolve_dependency, resolve_dependency_observed, resolve_dependency_with_inputs,
};

type PackageResolver<'a> = &'a mut dyn FnMut(&Path, &str, crate::PackageResolutionMode) -> bool;
type ObservedPackageResolver<'a> = &'a mut dyn FnMut(
    &Path,
    &str,
    crate::PackageResolutionMode,
)
    -> crate::package_route::stamp::Consumed<bool>;

impl VirtualProject {
    fn register_reachable_dependencies_inner(
        &mut self,
        initial_sources: Option<&[PathBuf]>,
        overlays: &FxHashMap<PathBuf, &str>,
        workspace_package_specifiers: &[CompactString],
        package_resolver: Option<PackageResolver<'_>>,
    ) -> CorsaResult<()> {
        self.register_reachable_dependencies_consumed_inner(
            initial_sources,
            overlays,
            workspace_package_specifiers,
            package_resolver,
            DependencyConsumption {
                aliases: None,
                resolver: None,
                registered_roots: None,
            },
        )
        .map(|_| ())
    }

    fn register_reachable_dependencies_consumed_inner(
        &mut self,
        initial_sources: Option<&[PathBuf]>,
        overlays: &FxHashMap<PathBuf, &str>,
        workspace_package_specifiers: &[CompactString],
        mut package_resolver: Option<PackageResolver<'_>>,
        consumption: DependencyConsumption<'_>,
    ) -> CorsaResult<crate::package_route::stamp::Consumed<Vec<PathBuf>>> {
        let DependencyConsumption {
            aliases: aliases_consumed,
            resolver: mut observed_package_resolver,
            registered_roots,
        } = consumption;
        let aliases_consumed_is_enabled = aliases_consumed.is_some();
        let (aliases, mut facts) = match aliases_consumed {
            Some(aliases) => observed::WalkFacts::from_aliases(aliases, &self.project_root),
            None => (self.dependency_alias_map(), observed::WalkFacts::disabled()),
        };
        let alias_prefixes: Vec<CompactString> = aliases
            .iter()
            .filter(|(pattern, target)| {
                facts.alias_may_reach_first_party(pattern, target, &self.project_root)
            })
            .map(|(pattern, _)| {
                CompactString::from(
                    pattern
                        .split_once('*')
                        .map_or(pattern.as_str(), |(prefix, _)| prefix),
                )
            })
            .collect();
        let declaration_alias_prefixes = aliases
            .iter()
            .map(|(pattern, _)| {
                CompactString::from(
                    pattern
                        .split_once('*')
                        .map_or(pattern.as_str(), |(prefix, _)| prefix),
                )
            })
            .collect::<Vec<_>>();
        let mut queue: Vec<PathBuf> = match initial_sources {
            Some(paths) => paths
                .iter()
                .filter(|path| {
                    let registered = self.find_by_original(path).is_some();
                    if !registered {
                        facts.unknown_at(71);
                    }
                    registered
                })
                .cloned()
                .collect(),
            None => self
                .virtual_files_sorted()
                .iter()
                .map(|file| file.original_path.clone())
                .collect(),
        };
        // Explicit patch importers retain current target graphs; full walks
        // keep their original queue-derived lookup identities.
        let mut key = |p: &PathBuf| facts.registered_key(p, self.find_by_original(p).is_some());
        let mut visited: FxHashSet<PathBuf> = if initial_sources.is_some() {
            self.registered_original_paths_sorted()
                .iter()
                .filter_map(&mut key)
                .collect()
        } else {
            queue.iter().filter_map(&mut key).collect()
        };
        // The original getter uses only registered bindings and their root index.
        // Compare that exact owner once; source-index membership may change during
        // the original walk without changing these getter inputs.
        let roots_qualified = match registered_roots {
            Some(roots) => {
                facts.registered_roots(roots);
                roots.qualified && self.registered_package_roots_are_current(&roots.value)
            }
            None => self.package_routes.is_empty() && self.package_route_roots.is_empty(),
        };
        if !roots_qualified {
            facts.unknown_at(72);
        }
        let (raw_roots_indexed, checked_roots) = self.raw_package_roots_are_indexed();
        let mut indexed_package_root_lookups = 0usize;
        let mut fallback_package_root_lookups = 0usize;

        while let Some(importer) = queue.pop() {
            let Some((virtual_content, virtual_path, generated_sfc)) =
                self.find_by_original(&importer).map(|file| {
                    (
                        self.module_source(file).unwrap_or(&file.content).clone(),
                        file.virtual_path.clone(),
                        file.source_map.sfc_map.is_some(),
                    )
                })
            else {
                facts.unknown_at(73);
                continue;
            };
            facts.begin_importer(
                &importer,
                self.original_contents
                    .get(&virtual_path)
                    .map(|source| source.as_bytes()),
            );
            let mut dependency_targets = FxHashSet::default();
            // Generated SFC projections carry synthetic triple-slash paths for
            // the type checker. Only references in the authored SFC source are
            // dependency edges; scanning the projection materializes the entire
            // project for each editor open.
            let references = if generated_sfc {
                self.original_contents
                    .get(&virtual_path)
                    .map_or_else(Vec::new, |source| references::path_references(source))
            } else {
                references::path_references(&virtual_content)
            };
            if references.is_empty()
                && !may_resolve_a_dependency(
                    &virtual_content,
                    if is_declaration_file(&importer) {
                        &declaration_alias_prefixes
                    } else {
                        &alias_prefixes
                    },
                    workspace_package_specifiers,
                )
            {
                let released = self.replace_dependency_edges(&importer, dependency_targets);
                self.prune_unowned_sources(released);
                facts.complete(&importer);
                continue;
            }
            let Some(importer_dir) = importer.parent().map(Path::to_path_buf) else {
                facts.unknown_at(74);
                continue;
            };
            let source_type = if virtual_path
                .extension()
                .is_some_and(|extension| extension == "tsx")
            {
                SourceType::tsx()
            } else {
                SourceType::ts()
            };
            let specifiers = self
                .rewriter()
                .collect_all_specifier_occurrences(&virtual_content, source_type)
                .into_iter()
                .map(|(specifier, mode)| (specifier, mode, false))
                .chain(
                    references
                        .into_iter()
                        .map(|specifier| (specifier, crate::PackageResolutionMode::Import, true)),
                );
            // Route bindings stay unchanged during this walk. Incomplete raw
            // roots and noncanonical originals retain their previous lookup.
            let use_root_index = raw_roots_indexed && visited.contains(&importer);
            if use_root_index {
                indexed_package_root_lookups += 1;
            } else {
                fallback_package_root_lookups += 1;
            }
            let importer_package_roots = self.package_roots_for_importer(&importer, use_root_index);

            for (specifier, mode, is_reference) in specifiers {
                // Path references are always relative to the containing file,
                // even without `./`; import aliases and packages do not apply.
                let native_target = if is_reference {
                    facts.probe_candidates(&importer_dir.join(&specifier))
                } else {
                    facts.resolve_dependency(
                        &specifier,
                        &importer_dir,
                        &self.project_root,
                        &aliases,
                    )
                };
                let Some(target) = native_target else {
                    if !is_reference {
                        if let Some(resolve) = observed_package_resolver.as_deref_mut() {
                            let _ = facts.package_result(resolve(&importer, &specifier, mode));
                        } else if let Some(resolve) = package_resolver.as_deref_mut() {
                            facts.unknown_at(75);
                            let _ = resolve(&importer, &specifier, mode);
                        }
                    }
                    continue;
                };
                let Some(key) = facts.canonical_key(&target) else {
                    continue;
                };
                let package_local = importer_package_roots
                    .iter()
                    .any(|package_root| key.starts_with(package_root));
                // A triple-slash path is an explicit program dependency, even
                // when it names a declaration under node_modules. Ordinary
                // package imports still use the resolver's package shadow.
                if inside_node_modules(&key) && !package_local && !is_reference {
                    continue;
                }
                // Declarations reached through a path reference must keep
                // their transitive declaration imports in this same mirror.
                // The final rewrite then points imports at that one identity.
                // Ordinary source imports can still use TypeScript's authored
                // declaration resolution without registering another root.
                if is_declaration_file(&key)
                    && !package_local
                    && !self.session_scripts
                    && !is_reference
                    && !is_declaration_file(&importer)
                {
                    continue;
                }
                // A requested subset still owns its complete import graph.
                // In-root scripts excluded by the scan are dependencies just
                // like out-of-root barrels; omitting them loses their types.
                dependency_targets.insert(key.clone());
                // A preceding changed owner can prune an already visited
                // target and its descendants before another owner acquires it.
                // The scoped walk skips only a registration that still exists;
                // full cold walks keep their original failed-inference policy.
                if !visited.insert(key.clone())
                    && (initial_sources.is_none() || self.find_by_original(&key).is_some())
                {
                    continue;
                }
                // Register the canonical path: a workspace symlink is
                // first-party where it actually lives, so it must not enter the
                // virtual tree under `node_modules`.
                // A reachable dependency is inferred, not requested: an
                // unreadable file or a malformed sibling-package SFC must not
                // abort the check the user actually asked for, so registration
                // failure degrades to the pre-#3887 ambient stub for that one
                // import instead of propagating (#3898).
                let registered = if aliases_consumed_is_enabled {
                    let packet = match overlays.get(&key) {
                        Some(content) => self.register_path_with_content_observed(&key, content),
                        None => self.register_path_observed(&key),
                    };
                    packet.map(|packet| facts.registration(packet))
                } else {
                    match overlays.get(&key) {
                        Some(content) => self.register_path_with_content(&key, content),
                        None => self.register_path(&key),
                    }
                };
                if registered.is_ok() {
                    queue.push(key);
                } else {
                    facts.unknown_at(76);
                }
            }
            let released = self.replace_dependency_edges(&importer, dependency_targets);
            self.prune_unowned_sources(released);
            facts.complete(&importer);
        }
        crate::corsa_bridge::preparation_trace::Phase::package_root_lookup(
            checked_roots,
            indexed_package_root_lookups,
            fallback_package_root_lookups,
        );
        Ok(facts.finish())
    }
}

#[cfg(test)]
#[path = "dependency_scan_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "dependency_scan/consumed_tests.rs"]
mod consumed_tests;
