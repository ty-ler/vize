//! The original single bounded reachability walk.

use super::{PackageRouteReachability, ReachabilityBudget, ReachabilityOutcome, ReachabilityWork};
use super::{finish, is_vue_runtime_support_specifier, route_graph, source_priority};
use oxc_span::SourceType;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};
use vize_carton::{FxHashSet, String as CompactString};

use super::ConsumedReachability;
use crate::package_route::stamp::{Consumed, InputStamp};

pub(super) fn scan_package_route_reachability_with_budget<ResolveLocal, ResolvePackage>(
    route: &crate::PackageRoute,
    mut resolve_local: ResolveLocal,
    mut resolve_package: ResolvePackage,
    budget: ReachabilityBudget,
) -> PackageRouteReachability
where
    ResolveLocal: FnMut(&Path, &str) -> (Option<PathBuf>, Vec<PathBuf>),
    ResolvePackage: FnMut(
        &Path,
        &str,
        crate::PackageResolutionMode,
    ) -> (Option<crate::PackageRoute>, Vec<PathBuf>),
{
    scan_package_route_reachability_observed(
        route,
        |path, specifier| Consumed {
            value: resolve_local(path, specifier),
            stamps: Vec::new(),
            qualified: false,
        },
        |path, specifier, mode| Consumed {
            value: resolve_package(path, specifier, mode),
            stamps: Vec::new(),
            qualified: false,
        },
        budget,
        false,
    )
    .value
    .reachability
}

pub(super) fn scan_package_route_reachability_observed<ResolveLocal, ResolvePackage>(
    route: &crate::PackageRoute,
    mut resolve_local: ResolveLocal,
    mut resolve_package: ResolvePackage,
    budget: ReachabilityBudget,
    route_qualified: bool,
) -> Consumed<ConsumedReachability>
where
    ResolveLocal: FnMut(&Path, &str) -> Consumed<(Option<PathBuf>, Vec<PathBuf>)>,
    ResolvePackage: FnMut(
        &Path,
        &str,
        crate::PackageResolutionMode,
    ) -> Consumed<(Option<crate::PackageRoute>, Vec<PathBuf>)>,
{
    let mut queued = FxHashSet::default();
    let mut queue = BinaryHeap::new();
    let mut inputs = Vec::new();
    let mut stamps = Vec::new();
    let mut qualified = route_qualified;
    let mut failures = Vec::new();
    let mut work = ReachabilityWork::default();
    let mut packages = FxHashSet::default();
    if !route_graph::seed_route_graph(
        route,
        &mut packages,
        &mut queue,
        &mut queued,
        &mut inputs,
        &mut work,
        budget,
    ) {
        return finish_observed(
            ReachabilityOutcome::BudgetExceeded,
            inputs,
            work,
            budget,
            stamps,
            qualified,
            failures,
        );
    }

    if queued
        .iter()
        .any(|path| path.extension().is_some_and(|extension| extension == "vue"))
    {
        return finish_observed(
            ReachabilityOutcome::ReachesVue,
            inputs,
            work,
            budget,
            stamps,
            qualified,
            failures,
        );
    }

    let rewriter = crate::batch::ImportRewriter::new();
    let mut edges = FxHashSet::<(PathBuf, CompactString, crate::PackageResolutionMode)>::default();
    while let Some((_, Reverse(path))) = queue.pop() {
        inputs.push(path.clone());
        if work.files == budget.max_files {
            return finish_observed(
                ReachabilityOutcome::BudgetExceeded,
                inputs,
                work,
                budget,
                stamps,
                qualified,
                failures,
            );
        }
        work.files += 1;

        let metadata_len = match std::fs::metadata(&path) {
            Ok(metadata) => metadata.len(),
            Err(error) => {
                failures.push((path.clone(), "metadata", error.kind()));
                stamps.push(InputStamp::observed_metadata_len(
                    path.clone(),
                    Err(error.kind()),
                ));
                continue;
            }
        };
        stamps.push(InputStamp::observed_metadata_len(
            path.clone(),
            Ok(metadata_len),
        ));
        let Ok(file_bytes) = usize::try_from(metadata_len) else {
            return finish_observed(
                ReachabilityOutcome::BudgetExceeded,
                inputs,
                work,
                budget,
                stamps,
                qualified,
                failures,
            );
        };
        if file_bytes > budget.max_file_bytes
            || work.bytes.saturating_add(file_bytes) > budget.max_total_bytes
        {
            return finish_observed(
                ReachabilityOutcome::BudgetExceeded,
                inputs,
                work,
                budget,
                stamps,
                qualified,
                failures,
            );
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                failures.push((path.clone(), "read_to_string", error.kind()));
                stamps.push(InputStamp::observed_read_failure(
                    path.clone(),
                    error.kind(),
                ));
                continue;
            }
        };
        stamps.push(InputStamp::observed_source(
            path.clone(),
            content.as_bytes(),
        ));
        if content.len() > budget.max_file_bytes
            || work.bytes.saturating_add(content.len()) > budget.max_total_bytes
        {
            return finish_observed(
                ReachabilityOutcome::BudgetExceeded,
                inputs,
                work,
                budget,
                stamps,
                qualified,
                failures,
            );
        }
        work.bytes += content.len();
        if work.parses == budget.max_parses {
            return finish_observed(
                ReachabilityOutcome::BudgetExceeded,
                inputs,
                work,
                budget,
                stamps,
                qualified,
                failures,
            );
        }
        work.parses += 1;
        let source_type = if path.extension().is_some_and(|extension| extension == "tsx") {
            SourceType::tsx()
        } else {
            SourceType::ts()
        };
        for (specifier, mode) in rewriter.collect_all_specifier_occurrences(&content, source_type) {
            if !edges.insert((path.clone(), specifier.clone(), mode)) {
                continue;
            }
            if work.edges == budget.max_edges {
                return finish_observed(
                    ReachabilityOutcome::BudgetExceeded,
                    inputs,
                    work,
                    budget,
                    stamps,
                    qualified,
                    failures,
                );
            }
            work.edges += 1;
            let local = resolve_local(&path, &specifier);
            stamps.extend(local.stamps);
            qualified &= local.qualified;
            let (local_dependency, local_inputs) = local.value;
            inputs.extend(local_inputs);
            if let Some(dependency) = local_dependency {
                inputs.push(dependency.clone());
                if dependency
                    .extension()
                    .is_some_and(|extension| extension == "vue")
                {
                    return finish_observed(
                        ReachabilityOutcome::ReachesVue,
                        inputs,
                        work,
                        budget,
                        stamps,
                        qualified,
                        failures,
                    );
                }
                if !queued.contains(&dependency) {
                    if queued.len() == budget.max_queued_files {
                        return finish_observed(
                            ReachabilityOutcome::BudgetExceeded,
                            inputs,
                            work,
                            budget,
                            stamps,
                            qualified,
                            failures,
                        );
                    }
                    queued.insert(dependency.clone());
                    queue.push((source_priority(&dependency), Reverse(dependency)));
                }
                continue;
            }
            if specifier.starts_with('.') || Path::new(specifier.as_str()).is_absolute() {
                continue;
            }
            // Canon supplies Vue's compiler/runtime types. They are terminal
            // support edges, not importer-scoped component packages.
            if is_vue_runtime_support_specifier(&specifier) {
                continue;
            }
            let nested_lookup = resolve_package(&path, &specifier, mode);
            stamps.extend(nested_lookup.stamps);
            qualified &= nested_lookup.qualified;
            let (nested, consulted) = nested_lookup.value;
            inputs.extend(consulted);
            if let Some(nested) = nested {
                if !route_graph::seed_route_graph(
                    &nested,
                    &mut packages,
                    &mut queue,
                    &mut queued,
                    &mut inputs,
                    &mut work,
                    budget,
                ) {
                    return finish_observed(
                        ReachabilityOutcome::BudgetExceeded,
                        inputs,
                        work,
                        budget,
                        stamps,
                        qualified,
                        failures,
                    );
                }
                if queued.iter().any(|source| {
                    source
                        .extension()
                        .is_some_and(|extension| extension == "vue")
                }) {
                    return finish_observed(
                        ReachabilityOutcome::ReachesVue,
                        inputs,
                        work,
                        budget,
                        stamps,
                        qualified,
                        failures,
                    );
                }
            }
        }
    }
    finish_observed(
        ReachabilityOutcome::DoesNotReachVue,
        inputs,
        work,
        budget,
        stamps,
        qualified,
        failures,
    )
}

fn finish_observed(
    outcome: ReachabilityOutcome,
    inputs: Vec<PathBuf>,
    work: ReachabilityWork,
    budget: ReachabilityBudget,
    stamps: Vec<InputStamp>,
    qualified: bool,
    failures: Vec<(PathBuf, &'static str, std::io::ErrorKind)>,
) -> Consumed<ConsumedReachability> {
    Consumed {
        value: ConsumedReachability {
            reachability: finish(outcome, inputs, work, budget),
            failures,
        },
        stamps,
        qualified,
    }
}
