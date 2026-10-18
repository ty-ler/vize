/** Current source admission and immutable pre-inheritance history have separate authorities. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  verifyHistoricalProducerFiles,
  verifyPackedCompileTimeInputs,
  verifySourceOnlyRust,
} from "./native-packed-config-source.ts";

/** Validate the exact reviewed main union, then return the unchanged historical inputs. */
export function verifyPackedFunctionalMainInheritance(root: string, workflowProducer: unknown) {
  const producer = "492c7dc6d04f34b792066f4483f24745e97a9301";
  const main = "2b1e41a5b09005a97d24d1ff34f34c7507bbfb67";
  const witnessPath =
    "tests/_fixtures/differential/vite-native-image-identity/packed-config-extension.json";
  const current = JSON.parse(fs.readFileSync(path.join(root, witnessPath), "utf8"));
  assert.equal(workflowProducer, producer);
  assert.equal(current.producer.head, producer);
  const checkpoint = current.producer.previousFunctionalMainInheritance;
  assert.deepEqual(checkpoint, {
    source: "379404e7dc24575daad93e5d131b5915e1c54a5d",
    producer: "d42a6e518c03b03107b5a81b3755af0bf6e8ac52",
    witnessSha256: "a1f38d1dbd6d9c3f25d7985db755f829bb512e6ab06a4ea24f30be0a59470245",
    sourceOnlySha256: "56019c20e22ee3d5eb1c7ff6d178c097ff7984c81576df55a8e72836d7d2b694",
    workflowSha256: "bfd577b7971490a3069e48aec5b02d87cd814b2d58aed181091cad8c1e409046",
  });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const oldBytes = git("show", checkpoint.source + ":" + witnessPath);
  assert.equal(digest(oldBytes), checkpoint.witnessSha256);
  const witness = JSON.parse(oldBytes.toString());
  assert.equal(witness.producer.head, checkpoint.producer);
  const roleBytes = git("show", checkpoint.source + ":" + witness.producer.sourceOnlyRust.path);
  assert.equal(digest(roleBytes), checkpoint.sourceOnlySha256);
  assert.equal(witness.producer.sourceOnlyRust.sha256, checkpoint.sourceOnlySha256);
  const oldRoles = JSON.parse(roleBytes.toString());
  assert.equal(oldRoles.producer, checkpoint.producer);
  const oldWorkflow = git("show", checkpoint.source + ":.github/workflows/native-smoke.yml");
  assert.equal(digest(oldWorkflow), checkpoint.workflowSha256);
  assert.equal(witness.afterSha256, checkpoint.workflowSha256);
  const oldProducer = /^      PACKED_CONFIG_PRODUCER: ([0-9a-f]{40})$/mu.exec(
    oldWorkflow.toString(),
  )?.[1];
  assert.equal(oldProducer, checkpoint.producer);
  for (const ancestor of [checkpoint.producer, main])
    git("merge-base", "--is-ancestor", ancestor, producer);
  git("merge-base", "--is-ancestor", producer, "HEAD");
  git("merge-base", "--is-ancestor", checkpoint.source, "HEAD");
  const oldFiles = Object.keys(witness.producer.files);
  assert.equal(oldFiles.length, 540);
  const newCompilerFiles = [
    "crates/vize_canon/src/batch/virtual_project/vue_codegen/generic_component_tests/native.rs",
    "crates/vize_canon/src/batch/virtual_project/vue_codegen/generic_component_tests/native/generated_diagnostics.rs",
    "crates/vize_canon/src/virtual_ts/expressions/prop_name_casing_tests.rs",
    "crates/vize_canon/src/virtual_ts/generator/component_export.rs",
    "crates/vize_canon/src/virtual_ts/scope/component_events/inference_helpers.rs",
    "crates/vize_canon/src/virtual_ts/scope/component_prop_checker.rs",
    "crates/vize_canon/tests/support/fix_history_observation.rs",
  ];
  const currentFiles = Object.keys(current.producer.files);
  assert.deepEqual(currentFiles, [...oldFiles, ...newCompilerFiles]);
  assert.equal(currentFiles.length, 547);
  assert.equal(new Set(currentFiles).size, currentFiles.length);
  assert.deepEqual(
    oldFiles.filter((file) => witness.producer.files[file] !== current.producer.files[file]),
    [
      "crates/vize_canon/src/virtual_ts/generator.rs",
      "crates/vize_canon/src/virtual_ts/scope/component_events.rs",
      "crates/vize_canon/src/virtual_ts/unknown_props_tests.rs",
      "crates/vize_canon/tests/empty_vue_star_exports/membership.rs",
      "tools/support/release/pr_pin.rs",
      "tools/support/release/preflight_pinned_evidence_tests.rs",
      "crates/vize_canon/src/batch/virtual_project/vue_codegen/generic_component_tests/native/tree.rs",
      "crates/vize_canon/src/batch/virtual_project/vue_codegen/generic_component_tests/native/tree/replay.rs",
      "crates/vize_canon/src/virtual_ts/public_instance_guard_tests.rs",
      "crates/vize_canon/src/virtual_ts/scope/component_events/generic_inference.rs",
      "crates/vize_glyph/src/template/formatter/tags.rs",
      "crates/vize_glyph/tests/template_directive_attributes.rs",
      "crates/vize_canon/src/virtual_ts/component_prop_helpers.txt",
      "crates/vize_maestro/tests/fixtures/split_script_checker.virtual.ts.txt",
    ],
    "only these reviewed old inputs change identity in this composition",
  );
  assert.deepEqual(
    Object.keys(current.producer).sort(),
    [...Object.keys(witness.producer), "previousFunctionalMainInheritance"].sort(),
  );
  for (const [field, value] of Object.entries(witness.producer))
    if (!["head", "files", "sourceOnlyRust"].includes(field))
      assert.deepEqual(current.producer[field], value, "preserved complete history: " + field);
  const currentRoleBytes = fs.readFileSync(path.join(root, current.producer.sourceOnlyRust.path));
  assert.equal(digest(currentRoleBytes), current.producer.sourceOnlyRust.sha256);
  const currentRoles = JSON.parse(currentRoleBytes.toString());
  assert.equal(currentRoles.producer, producer);
  assert.equal(currentRoles.main, main);
  assert.equal(currentRoles.priorSource, oldRoles.priorSource);
  assert.deepEqual(currentRoles.previousFunctionalMainInheritance, checkpoint);
  const newSourceOnlyFiles = [
    "tools/support/release/pr_pin_process.rs",
    "tools/support/release/pr_pin_process_tests.rs",
    "tools/support/release/pr_pin_rollback.rs",
    "tools/support/release/pr_pin_rollback_tests.rs",
    "tools/support/release/pr_pin_watch_tests.rs",
    "tools/support/release/preflight_job_evidence.rs",
    "tools/support/typecheck_process_session.rs",
  ];
  assert.deepEqual(
    Object.keys(currentRoles.files),
    [...Object.keys(oldRoles.files), ...newSourceOnlyFiles].sort(),
  );
  assert.equal(Object.keys(oldRoles.files).length, 39);
  assert.equal(Object.keys(currentRoles.files).length, 46);
  assert.deepEqual(
    Object.keys(currentRoles).sort(),
    [...Object.keys(oldRoles), "previousFunctionalMainInheritance"].sort(),
  );
  for (const file of newSourceOnlyFiles) {
    assert.equal(currentRoles.files[file].retiredAt, null, file);
  }
  for (const [field, value] of Object.entries(oldRoles))
    if (!["producer", "main", "files"].includes(field))
      assert.deepEqual(currentRoles[field], value, "preserved complete role history: " + field);
  for (const [file, priorRow] of Object.entries(oldRoles.files)) {
    const row = currentRoles.files[file];
    assert.equal(row.compilerBound, false);
    const oldRow = priorRow as { prior: unknown; retiredAt: unknown };
    assert.deepEqual(row.prior, oldRow.prior, file);
    assert.equal(row.retiredAt, oldRow.retiredAt, file);
  }
  const changedRust = git(
    "diff",
    "--name-only",
    "--no-renames",
    current.producer.composedBase,
    producer,
    "--",
    "*.rs",
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(changedRust.length, 560);
  const selected = git("rev-parse", "HEAD").toString().trim();
  // These existing guards independently bind every current path/mode/blob/byte,
  // exact finite role, physical file, absence, ancestry and ALL Rust source deltas.
  verifySourceOnlyRust(root, current.producer, selected);
  verifyHistoricalProducerFiles(root, current.producer);
  git("diff", "--exit-code", producer, selected, "--", ...currentFiles);
  for (const [file, expected] of Object.entries(current.producer.files)) {
    const filename = path.join(root, file);
    const physical = fs.lstatSync(filename, { throwIfNoEntry: false });
    if (expected === null) assert.equal(physical, undefined, file);
    else {
      assert.equal(typeof expected, "string", file);
      assert.ok(physical?.isFile(), file);
      assert.equal(digest(fs.readFileSync(filename)), expected, file);
    }
  }
  verifyPackedCompileTimeInputs(current.producer);
  return { witness, roleBytes, workflowProducer: oldProducer };
}
