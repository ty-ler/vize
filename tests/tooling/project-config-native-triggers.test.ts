import assert from "node:assert/strict";
import { matchesGlob } from "node:path";
import test from "node:test";
import { readRepoFile } from "./support/github-workflows.ts";

test("native configuration qualification covers nested contracts and runtime custody dependencies", () => {
  const workflow = readRepoFile(".github/workflows/project-config-native.yml");
  const pathBody = workflow.match(/\n    paths:\n([\s\S]*?)\npermissions:/)?.[1];
  assert.ok(pathBody, "pull-request qualification must declare its source scope");
  const paths = [...pathBody.matchAll(/^\s+- "([^"]+)"$/gm)].map((match) => match[1]);
  const owners = [
    ".github/workflows/project-config-native.yml",
    "crates/vize/tests/project_config_cli.rs",
    "crates/vize/tests/project_config_cli/nested_lsp/executor.rs",
    "crates/vize/tests/project_config_cli/nested_lsp/marker_lifecycle.rs",
    "crates/vize/tests/support/lsp_process.rs",
    "crates/vize/tests/support/lsp_process/capture.rs",
    "tests/differential/project-config-native-receipt.ts",
    "tests/differential/project-config-native-run.ts",
    "tests/differential/build-receipt.ts",
    "tests/differential/sha256.ts",
    "crates/vize_carton/src/config/loader/lsp_snapshot.rs",
    "crates/vize_canon/src/lsp_client/editor_lsp/configured_project/shared_transport.rs",
    "crates/vize_canon/src/lsp_client/editor_lsp/readiness.rs",
    "crates/vize_maestro/src/server/state/project_contexts.rs",
    "crates/vize_maestro/src/server/state/project_contexts/watched.rs",
    "crates/vize_maestro/src/ide/diagnostics/native.rs",
    "tests/_fixtures/differential/config/config-free.json",
    "Cargo.toml",
    "Cargo.lock",
    "pnpm-lock.yaml",
  ];
  for (const owner of owners) {
    assert.ok(
      paths.some((pattern) => matchesGlob(owner, pattern)),
      `${owner} must trigger native qualification`,
    );
  }
  assert.equal(
    paths.some((pattern) => matchesGlob("docs/guide/unrelated.md", pattern)),
    false,
  );
});
