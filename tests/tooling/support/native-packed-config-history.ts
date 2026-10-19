import { verifyPackedFunctionalMainInheritance } from "./native-packed-config-main-inheritance.ts";
import { verifyPackedCompileTimeInputs } from "./native-packed-config-source.ts";
/** Complete immutable packed-producer history; current admission stays in the real guard. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readPackedProducerRetirement,
  verifyHistoricalProducerFiles,
} from "./native-packed-config-extension.ts";

export function verifyPackedProducerHistory(root: string, currentWorkflowProducer: unknown): void {
  const { witness, roleBytes, workflowProducer } = verifyPackedFunctionalMainInheritance(
    root,
    currentWorkflowProducer,
  );
  const producer = "d42a6e518c03b03107b5a81b3755af0bf6e8ac52";
  const witnessPath =
    "tests/_fixtures/differential/vite-native-image-identity/packed-config-extension.json";
  assert.equal(workflowProducer, producer);
  assert.equal(witness.producer.head, producer);
  assert.equal(witness.producer.composedBase, "178bbe12ea5cb939c2b43f4cc0656e45952c6d3b");
  assert.equal(witness.producer.priorProducer, "820bf6b5d688c77f8edea6ba18ff6f86f76bffae");
  assert.equal(witness.producer.previousFrozenProducer, "c8855589af88f3804686959377d29e85e3d7a4f4");
  assert.equal(witness.producer.earlierFrozenProducer, "9654d136f504765f0dfbdb1e17cf806e0b967878");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const files = Object.keys(witness.producer.files);
  assert.equal(files.length, 540);
  assert.equal(new Set(files).size, files.length);
  const changedRust = git(
    "diff",
    "--name-only",
    "--no-renames",
    witness.producer.composedBase,
    producer,
  )
    .toString()
    .trim()
    .split("\n")
    .filter((file) => file.endsWith(".rs"));
  assert.equal(changedRust.length, 546);
  assert.equal(digest(roleBytes), witness.producer.sourceOnlyRust.sha256);
  const roles = JSON.parse(roleBytes.toString());
  assert.equal(roles.producer, producer);
  assert.equal(roles.priorSource, "e0bc8fb50bdc28915167a3fbdceea86f00b65030");
  assert.equal(roles.main, "31447d1ac9326ae87529f3da84d1c99f00d4f038");
  const sourceOnly = Object.keys(roles.files);
  assert.deepEqual(sourceOnly, [
    "tools/commands/ci/github/release-preflight.rs",
    "tools/commands/ci/source-file-lengths.rs",
    "tools/commands/fixtures/lint-divergence-report.rs",
    "tools/commands/fixtures/typecheck-divergence-report.rs",
    "tools/commands/release/pr.rs",
    "tools/support/lint_divergence_surface.rs",
    "tools/support/release/pr_ci.rs",
    "tools/support/release/pr_pin.rs",
    "tools/support/release/pr_pin_body.rs",
    "tools/support/release/pr_pin_body_observed_tests.rs",
    "tools/support/release/pr_pin_body_tests.rs",
    "tools/support/release/pr_pin_budget_tests.rs",
    "tools/support/release/pr_pin_candidate.rs",
    "tools/support/release/pr_pin_integration.rs",
    "tools/support/release/pr_pin_lock.rs",
    "tools/support/release/pr_pin_lock_tests.rs",
    "tools/support/release/pr_pin_metadata.rs",
    "tools/support/release/pr_pin_queue.rs",
    "tools/support/release/pr_pin_queue_tests.rs",
    "tools/support/release/pr_pin_retire.rs",
    "tools/support/release/pr_pin_retire_archive.rs",
    "tools/support/release/pr_pin_retire_evidence.rs",
    "tools/support/release/pr_pin_retire_guard.rs",
    "tools/support/release/pr_pin_retire_ledger.rs",
    "tools/support/release/pr_pin_retire_lifecycle_tests.rs",
    "tools/support/release/pr_pin_retire_prequalification_archive_tests.rs",
    "tools/support/release/pr_pin_retire_source.rs",
    "tools/support/release/pr_pin_runs.rs",
    "tools/support/release/pr_pin_start.rs",
    "tools/support/release/pr_pin_target_tests.rs",
    "tools/support/release/pr_pin_tests.rs",
    "tools/support/release/pr_pin_watch.rs",
    "tools/support/release/pr_promote.rs",
    "tools/support/release/pr_tests.rs",
    "tools/support/release/pr_watch.rs",
    "tools/support/release/preflight_pinned_evidence_tests.rs",
    "tools/support/typecheck_baseline_usability.rs",
    "tools/support/typecheck_mutation_recovery.rs",
    "tools/support/typecheck_project_deadline.rs",
  ]);
  for (const row of Object.values(roles.files) as { compilerBound: boolean }[])
    assert.equal(row.compilerBound, false);
  const historicalAbsences = witness.producer.historicalRenames.map(
    (rename: { from: string }) => rename.from,
  );
  assert.deepEqual(
    [
      ...files.filter(
        (file) =>
          file.endsWith(".rs") && !historicalAbsences.includes(file) && !sourceOnly.includes(file),
      ),
      ...sourceOnly,
    ].sort(),
    changedRust.sort(),
    "complete Rust composition, including additions and deletion, is authenticated",
  );
  assert.deepEqual(
    files.filter((file) => !file.endsWith(".rs")),
    [
      "Cargo.lock",
      "Cargo.toml",
      "crates/vize/src/commands/inspector/official_compiler.ts",
      "crates/vize_carton/src/config/loader/module-runtime.d.mts",
      "crates/vize_carton/src/config/loader/module-runtime.mjs",
      "tests/_fixtures/content-mapper/escaton-nested-flow-9433.json",
      "tests/_fixtures/differential/linter/computed-suppression-reka/NavigationMenuContentImpl.vue.fixture",
      "tests/_fixtures/differential/lsp/component-native-events/checked-native.expected.json",
      "tests/_fixtures/content-mapper/with-defaults-surplus.json",
      "crates/vize_canon/src/virtual_ts/component_prop_helpers.txt",
      "tests/_fixtures/differential/lsp/component-native-events/public-input-prelude-before-9498.txt",
      "crates/vize_armature/tests/_fixtures/empty_attribute_value_witness.bin",
      "crates/vize_armature/tests/_fixtures/tokenizer_parser_fixtures.bin",
      "tests/_fixtures/content-mapper/escaton-public-props-9498.json",
      "crates/vize_canon/tests/fixtures/projection-carriers-svg-9200.json",
      "tests/_fixtures/differential/lsp/lint-hover-severity/responses.authored.json",
      "tests/_fixtures/differential/lsp/lint-hover-severity/App.vue.txt",
      "crates/vize_maestro/tests/fixtures/split_script_checker.virtual.ts.txt",
      "tests/_fixtures/differential/lint/native-svg-content/cases.json",
      "tests/_fixtures/differential/lint/native-svg-content/FacetBarChart.vue",
      "tests/_fixtures/differential/lint/native-svg-content/TimelineChartDepSizeSvgSlot.vue",
    ],
  );
  assert.deepEqual(witness.producer.cargoInputs, ["Cargo.lock", "Cargo.toml"]);
  git("merge-base", "--is-ancestor", producer, "HEAD");
  assert.deepEqual(witness.producer.absentFiles, [
    "crates/vize/src/commands/check/runner/input_scope/tests.rs",
    "crates/vize_croquis/src/drawer/helpers/identifiers/ast/walk/retained_assignments.rs",
    "crates/vize_croquis/src/drawer/helpers/identifiers/ast/walk/retained_scopes.rs",
  ]);
  const [deletion] = witness.producer.netRustDeletions;
  assert.equal(witness.producer.netRustDeletions.length, 1);
  assert.equal(deletion.from, "crates/vize/src/commands/check/runner/input_scope/tests.rs");
  assert.equal(deletion.to, "crates/vize/src/commands/check/runner/input_scope_tests.rs");
  assert.equal(deletion.fromSource, witness.producer.composedBase);
  assert.equal(deletion.toSource, "a9dec43c406c7afd1d2ce8067fc563678e28ac64");
  assert.equal(digest(git("show", deletion.fromSource + ":" + deletion.from)), deletion.fromSha256);
  assert.equal(digest(git("show", deletion.toSource + ":" + deletion.to)), deletion.toSha256);
  const removedRust = git(
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=D",
    witness.producer.composedBase,
    producer,
  )
    .toString()
    .trim()
    .split("\n")
    .filter((file) => file.endsWith(".rs"));
  const retirement = readPackedProducerRetirement(root, witness.producer);
  assert.equal(retirement.source, "7136efec7025c009299b583b36c40b2dc9b7424e");
  assert.equal(retirement.retiredAt, "c022cf601c6e49b14dbcc57093948c56f132cc55");
  assert.equal(Object.keys(retirement.files).length, 98);
  assert.deepEqual(
    removedRust.sort((left, right) => left.localeCompare(right)),
    [
      deletion.from,
      ...Object.keys(retirement.files),
      ...sourceOnly.filter((file) => roles.files[file].current === null),
    ].sort((left: string, right: string) => left.localeCompare(right)),
  );
  assert.equal(Object.values(witness.producer.files).filter((value) => value === null).length, 101);
  // Past composition laws compare two immutable checkpoints; current admission is
  // independently checked above and by the real selected-source guard.
  const checkpoint = witness.producer.previousFunctionalSource;
  assert.equal(checkpoint.source, "1999a60c7688494cb952b1855e95aa10ab80fcfa");
  const checkpointBytes = git("show", checkpoint.source + ":" + witnessPath);
  assert.equal(digest(checkpointBytes), checkpoint.witnessSha256);
  const checkpointWitness = JSON.parse(checkpointBytes.toString());
  assert.equal(checkpointWitness.producer.head, checkpoint.producer);
  assert.equal(Object.keys(checkpointWitness.producer.files).length, 424);
  assert.ok(Object.keys(checkpointWitness.producer.files).every((file) => files.includes(file)));
  const checkpointRoleBytes = git(
    "show",
    checkpoint.source + ":" + witness.producer.sourceOnlyRust.path,
  );
  assert.equal(digest(checkpointRoleBytes), checkpoint.sourceOnlySha256);
  const checkpointRoles = JSON.parse(checkpointRoleBytes.toString());
  assert.equal(
    digest(git("show", checkpoint.source + ":.github/workflows/native-smoke.yml")),
    checkpoint.workflowSha256,
  );
  const checkpointFiles = Object.keys(checkpointWitness.producer.files);
  const qualification = witness.producer.previousQualification;
  assert.equal(qualification.source, retirement.source);
  assert.equal(qualification.producer, "c45e0901fc05cfa51c50d167ac97a34ec466dd18");
  const previousQualification = git("show", qualification.source + ":" + witnessPath);
  assert.equal(digest(previousQualification), qualification.witnessSha256);
  assert.equal(
    digest(git("show", qualification.source + ":.github/workflows/native-smoke.yml")),
    qualification.workflowSha256,
  );
  const previousQualificationWitness = JSON.parse(previousQualification.toString());
  assert.equal(Object.keys(previousQualificationWitness.producer.files).length, 212);
  for (const file of Object.keys(previousQualificationWitness.producer.files))
    assert.ok(files.includes(file), file);
  const diagnostic = witness.producer.previousDiagnostic;
  assert.equal(diagnostic.source, "eb01ef3ace9ed68513b7cf65ca426d73ea139f46");
  assert.equal(diagnostic.producer, "47284d8e618b660658bdd28445306e18cfddca90");
  const previousDiagnosticBytes = git("show", diagnostic.source + ":" + witnessPath);
  assert.equal(digest(previousDiagnosticBytes), diagnostic.witnessSha256);
  assert.equal(
    digest(git("show", diagnostic.source + ":.github/workflows/native-smoke.yml")),
    diagnostic.workflowSha256,
  );
  const previousDiagnostic = JSON.parse(previousDiagnosticBytes.toString());
  assert.equal(Object.keys(previousDiagnostic.producer.files).length, 343);
  const addedDiagnosticInputs = [
    "crates/vize/src/commands/content_mapper.rs",
    "crates/vize/src/commands/content_mapper/project.rs",
    "crates/vize/src/commands/content_mapper/project_tests.rs",
    "crates/vize/src/commands/content_mapper/test_support.rs",
    "crates/vize/src/commands/content_mapper/tests.rs",
    "crates/vize/tests/check_flow_depth_isolation_cli.rs",
    "crates/vize_armature/src/parser/whitespace.rs",
    "crates/vize_armature/src/parser/whitespace/tests.rs",
    "crates/vize_atelier_dom/tests/dev_root_fragment.rs",
    "crates/vize_canon/src/batch/executor/session.rs",
    "crates/vize_canon/src/batch/executor/session/tests.rs",
    "crates/vize_canon/src/batch/virtual_project/build/css_modules.rs",
    "crates/vize_canon/src/batch/virtual_project/build/css_modules/tests.rs",
    "crates/vize_canon/src/batch/virtual_project/content_mapper.rs",
    "crates/vize_canon/src/batch/virtual_project/content_mapper_config.rs",
    "crates/vize_canon/src/batch/virtual_project/identity.rs",
    "crates/vize_canon/src/css_classes.rs",
    "crates/vize_canon/src/lsp_client/editor_lsp/native_shutdown/tests.rs",
    "crates/vize_canon/src/lsp_client/editor_lsp/tests.rs",
    "crates/vize_canon/src/virtual_ts/generator.rs",
    "crates/vize_canon/src/virtual_ts/generator/setup_props.rs",
    "crates/vize_canon/src/virtual_ts/scope/vif_guard.rs",
    "crates/vize_canon/src/virtual_ts/scope/vif_guard_chain.rs",
    "crates/vize_canon/src/virtual_ts/tests/auto_import_shadowing.rs",
    "crates/vize_glyph/src/options.rs",
    "crates/vize_glyph/tests/format_presets.rs",
    "crates/vize_maestro/src/ide/completion/template/css_modules.rs",
    "crates/vize_patina/src/linter/tests/no_mutating_props.rs",
    "crates/vize_patina/src/markup/differential/battery.rs",
    "crates/vize_patina/src/markup/l2/children.rs",
    "crates/vize_patina/src/markup/tests/differential_tests.rs",
    "crates/vize_patina/src/preset/tests.rs",
    "crates/vize_patina/src/rule.rs",
    "crates/vize_patina/src/rules/vue/no_non_component_keep_alive_child.rs",
    "crates/vize_patina/src/rules/vue/no_non_component_keep_alive_child_tests.rs",
    "crates/vize_patina/src/rules/vue/v_slot_style/tests.rs",
    "crates/vize_vitrine/src/napi/lint/file_collection/oxlint_html_profile.rs",
    "crates/vize_vitrine/src/napi/lint/file_collection/oxlint_html_profile/envelope.rs",
    "crates/vize_vitrine/src/napi/lint/file_collection/oxlint_html_profile/git_metadata.rs",
    "crates/vize_vitrine/src/napi/lint/file_collection/oxlint_html_profile/policy.rs",
    "crates/vize_vitrine/src/napi/lint/file_collection/oxlint_html_profile/tests.rs",
    "crates/vize_vitrine/src/napi/lint/file_collection/oxlint_html_profile/tests/git_metadata.rs",
    "crates/vize_vitrine/src/napi/lint/oxlint_html_binding/conversion.rs",
    "davinci/vize_l1_to_l2/src/emit/flag.rs",
    "davinci/vize_l1_to_l2/src/emit/fragment.rs",
    "davinci/vize_l1_to_l2/src/lower.rs",
    "davinci/vize_l1_to_l2/src/lower/text.rs",
    "davinci/vize_l1_to_l2/src/lower/text/branch_gap.rs",
    "davinci/vize_l1_to_l2/src/lower/text/condense.rs",
  ];
  const addedForwardInputs = [
    "crates/vize/src/commands/inspector.rs",
    "crates/vize/src/commands/inspector/compare.rs",
    "crates/vize/src/commands/inspector/official_compiler.ts",
    "crates/vize/tests/support/event_completion_project.rs",
    "crates/vize_canon/src/lsp_client/editor_lsp/native_shutdown.rs",
    "crates/vize_canon/src/sfc_typecheck/tests.rs",
    "crates/vize_canon/src/virtual_ts/expressions/vif_chain.rs",
    "crates/vize_canon/src/virtual_ts/expressions/vif_chain/emit.rs",
    "crates/vize_canon/src/virtual_ts/generator/emits.rs",
    "crates/vize_canon/src/virtual_ts/generator/generics.rs",
    "crates/vize_canon/src/virtual_ts/generator/setup_helpers.rs",
    "crates/vize_canon/src/virtual_ts/generator/setup_scope.rs",
    "crates/vize_canon/src/virtual_ts/legacy_vue2_vuetify_tests.rs",
    "crates/vize_canon/src/virtual_ts/scope/component_events.rs",
    "crates/vize_canon/src/virtual_ts/scope/component_prop_checker/check_helpers.rs",
    "crates/vize_canon/src/virtual_ts/scope/event_scope/component_scope.rs",
    "crates/vize_canon/src/virtual_ts/tests.rs",
    "crates/vize_canon/src/virtual_ts/tests/generic_module_type_exports.rs",
    "crates/vize_canon/src/virtual_ts/tests/vif_chain.rs",
    "crates/vize_canon/src/virtual_ts/type_dependencies.rs",
    "crates/vize_canon/src/virtual_ts/unknown_props_tests.rs",
    "crates/vize_canon/tests/component_event_arity.rs",
    "crates/vize_canon/tests/empty_vue_star_exports/membership.rs",
    "crates/vize_patina/src/context/eslint_directive.rs",
    "crates/vize_patina/tests/computed_suppression_history.rs",
    "crates/vize_vitrine/src/napi/sfc/parse.rs",
    "tests/_fixtures/content-mapper/escaton-nested-flow-9433.json",
    "tests/_fixtures/differential/linter/computed-suppression-reka/NavigationMenuContentImpl.vue.fixture",
    "tests/_fixtures/differential/lsp/component-native-events/checked-native.expected.json",
  ];
  const addedReceiptInputs = [
    "crates/vize_canon/tests/support/tier_l_incremental_failure.rs",
    "crates/vize_canon/tests/support/tier_l_incremental_failure_tests.rs",
    "crates/vize_canon/tests/tier_l_incremental.rs",
  ];
  assert.deepEqual(
    files.filter((file) => addedReceiptInputs.includes(file)),
    addedReceiptInputs,
  );
  assert.deepEqual(
    checkpointFiles.filter(
      (file) =>
        ![...addedDiagnosticInputs, ...addedForwardInputs, ...addedReceiptInputs].includes(file),
    ),
    Object.keys(previousDiagnostic.producer.files),
  );
  const changedDiagnosticInputs = Object.keys(previousDiagnostic.producer.files).filter(
    (file) => previousDiagnostic.producer.files[file] !== checkpointWitness.producer.files[file],
  );
  assert.deepEqual(changedDiagnosticInputs, [
    "Cargo.lock",
    "Cargo.toml",
    "crates/vize/tests/check_tsconfig_bom_cli.rs",
    "crates/vize/tests/lint_legacy_instance_api_cli.rs",
    "crates/vize/tests/lint_preset_scope_cli.rs",
    "crates/vize/tests/support/legacy_instance_cli.rs",
    "crates/vize_canon/src/batch.rs",
    "crates/vize_canon/src/batch/virtual_project.rs",
    "crates/vize_canon/src/batch/virtual_project/tsconfig_gen.rs",
    "crates/vize_canon/src/batch/virtual_project/tsconfig_gen/compiler_inputs.rs",
    "crates/vize_canon/src/batch/virtual_project/tsconfig_gen/vue_compiler_options.rs",
    "crates/vize_canon/src/batch/virtual_project/tsconfig_paths.rs",
    "crates/vize_canon/src/corsa_bridge/preparation_trace.rs",
    "crates/vize_canon/src/lib.rs",
    "crates/vize_canon/src/package_route/stamp.rs",
    "crates/vize_maestro/src/server/state/project_contexts/freshness.rs",
    "crates/vize_maestro/src/server/state/project_contexts/freshness_tests.rs",
    "crates/vize_patina/src/linter/script_rules/registry/rules.rs",
    "crates/vize_patina/src/preset/default_warning_tests.rs",
    "tools/commands/release/pr.rs",
    "tools/support/release/pr_ci.rs",
    "tools/support/release/pr_pin.rs",
    "tools/support/release/pr_pin_runs.rs",
    "tools/support/release/pr_watch.rs",
  ]);
  const latest = roles.latestDiagnostic;
  assert.equal(latest.source, "3bfb3885f3328133968731873d2414773d00ee4a");
  assert.equal(latest.producer, roles.priorSource);
  const latestBytes = git("show", latest.source + ":" + witnessPath);
  assert.equal(digest(latestBytes), latest.witnessSha256);
  assert.equal(
    digest(git("show", latest.source + ":.github/workflows/native-smoke.yml")),
    latest.workflowSha256,
  );
  const latestWitness = JSON.parse(latestBytes.toString());
  assert.equal(Object.keys(latestWitness.producer.files).length, 343);
  for (const file of Object.keys(latestWitness.producer.files))
    assert.ok(files.includes(file), file);
  for (const field of [
    "previousFreeze",
    "priorAdmission",
    "retiredRust",
    "previousQualification",
    "previousDiagnostic",
  ])
    assert.deepEqual(witness.producer[field], latestWitness.producer[field]);
  const composition = witness.producer.previousComposition;
  assert.equal(composition.source, "ecb83f915f53aaf82b4b04980e26cd36b4f43f62");
  assert.equal(composition.producer, "92854153b932a287f441dea8a8e903c885fc2c9d");
  git("merge-base", "--is-ancestor", composition.producer, witness.producer.head);
  git("merge-base", "--is-ancestor", composition.source, "HEAD");
  const compositionBytes = git("show", composition.source + ":" + witnessPath);
  assert.equal(digest(compositionBytes), composition.witnessSha256);
  const priorComposition = JSON.parse(compositionBytes.toString());
  assert.equal(priorComposition.producer.head, composition.producer);
  for (const file of Object.keys(priorComposition.producer.files))
    assert.ok(file in witness.producer.files, file);
  assert.equal(
    digest(git("show", composition.source + ":" + witness.producer.sourceOnlyRust.path)),
    composition.sourceOnlySha256,
  );
  assert.equal(
    digest(git("show", composition.source + ":.github/workflows/native-smoke.yml")),
    composition.workflowSha256,
  );
  const functionalPrefix = witness.producer.previousFunctionalPrefix;
  assert.equal(functionalPrefix.source, "7874110f49090f8cde882d6765a0e28a494fbffa");
  assert.equal(functionalPrefix.producer, "8e50ef28b93435d1681dd274ab88399daa5503e2");
  git("merge-base", "--is-ancestor", functionalPrefix.producer, producer);
  git("merge-base", "--is-ancestor", functionalPrefix.source, "HEAD");
  const prefixBytes = git("show", functionalPrefix.source + ":" + witnessPath);
  assert.equal(digest(prefixBytes), functionalPrefix.witnessSha256);
  const priorPrefix = JSON.parse(prefixBytes.toString());
  assert.equal(priorPrefix.producer.head, functionalPrefix.producer);
  assert.equal(Object.keys(priorPrefix.producer.files).length, 392);
  assert.deepEqual(
    checkpointFiles.filter(
      (file) => ![...addedForwardInputs, ...addedReceiptInputs].includes(file),
    ),
    Object.keys(priorPrefix.producer.files),
  );
  assert.deepEqual(
    Object.keys(priorPrefix.producer.files).filter(
      (file) => priorPrefix.producer.files[file] !== checkpointWitness.producer.files[file],
    ),
    [
      "Cargo.lock",
      "Cargo.toml",
      "crates/vize/tests/check_tsconfig_bom_cli.rs",
      "crates/vize_canon/src/lsp_client/editor_lsp/native_shutdown/tests.rs",
      "crates/vize_maestro/src/server/state/project_contexts/freshness.rs",
      "crates/vize_maestro/src/server/state/project_contexts/freshness_tests.rs",
    ],
  );
  const prefixRoleBytes = git(
    "show",
    functionalPrefix.source + ":" + witness.producer.sourceOnlyRust.path,
  );
  assert.equal(digest(prefixRoleBytes), functionalPrefix.sourceOnlySha256);
  assert.deepEqual(JSON.parse(prefixRoleBytes.toString()).files, checkpointRoles.files);
  assert.equal(
    digest(git("show", functionalPrefix.source + ":.github/workflows/native-smoke.yml")),
    functionalPrefix.workflowSha256,
  );
  verifyPackedCompileTimeInputs(witness.producer);
  verifyHistoricalProducerFiles(root, witness.producer);
  const original = witness.producer.previousFreeze;
  assert.equal(original.source, "f7ee25f5db27bd210db07f514837b9f4c1b65054");
  assert.equal(original.head, "5089dd1ad6dae7fbf6fc9efb33f202f8824f6f1e");
  const previous = JSON.parse(git("show", original.source + ":" + witnessPath).toString());
  assert.deepEqual(original.files, previous.producer.files);
  assert.equal(Object.keys(original.files).length, 26);
  for (const file of Object.keys(original.files)) assert.ok(files.includes(file), file);
  assert.equal(
    digest(git("show", original.source + ":.github/workflows/native-smoke.yml")),
    original.workflowSha256,
  );
  const prior = witness.producer.priorAdmission;
  assert.equal(prior.source, "35d5b71d364a59accfa7f64dcfc23fa3667be417");
  assert.equal(prior.producer, "a9dec43c406c7afd1d2ce8067fc563678e28ac64");
  assert.equal(prior.witnessPath, witnessPath);
  const priorBytes = git("show", prior.source + ":" + witnessPath);
  assert.equal(digest(priorBytes), prior.witnessSha256);
  const priorWitness = JSON.parse(priorBytes.toString());
  assert.equal(
    digest(git("show", prior.source + ":.github/workflows/native-smoke.yml")),
    prior.workflowSha256,
  );
  assert.equal(Object.keys(priorWitness.producer.files).length, 197);
  for (const file of Object.keys(priorWitness.producer.files))
    assert.ok(files.includes(file), file);
  for (const field of ["previousFreeze", "absentFiles", "historicalRenames", "netRustDeletions"])
    assert.deepEqual(witness.producer[field], priorWitness.producer[field], field);
  const historicalBase = "85b7c8d4b12226b67eaf23dd7b84fb14b616c832";
  const prefix = "crates/vize_croquis/src/drawer/helpers/identifiers/ast/walk/";
  const renames = git(
    "diff",
    "--name-status",
    "--find-renames",
    historicalBase,
    "a9dec43c406c7afd1d2ce8067fc563678e28ac64",
  ).toString();
  for (const [index, name] of ["assignments", "scopes"].entries()) {
    const from = prefix + "retained_" + name + ".rs",
      to = prefix + "retained/" + name + ".rs";
    const record = witness.producer.historicalRenames[index];
    assert.equal(record.status, "R100");
    assert.equal(record.fromSource, historicalBase);
    assert.equal(record.toSource, "a9dec43c406c7afd1d2ce8067fc563678e28ac64");
    assert.equal(record.from, from);
    assert.equal(record.to, to);
    assert.ok(renames.split("\n").includes(["R100", from, to].join("\t")));
    assert.equal(
      git("ls-tree", "--name-only", witness.producer.composedBase, "--", from).length,
      0,
    );
    assert.equal(record.absentAtBase, true);
    assert.equal(digest(git("show", historicalBase + ":" + from)), record.fromSha256);
    assert.equal(digest(git("show", record.toSource + ":" + to)), record.toSha256);
    assert.equal(record.fromSha256, record.toSha256, "the whole renamed source stays exact");
  }
}
