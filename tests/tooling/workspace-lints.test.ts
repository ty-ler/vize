import assert from "node:assert/strict";
import { test } from "node:test";
import { runWorkspaceLints } from "../../tools/commands/ci/check-workspace-lints.ts";

const joined = "[package]\nname = 'first'\n[lints]\nworkspace = true\n";
const root = (members: string[]) =>
  `members = [${members.map((member) => JSON.stringify(member)).join(", ")}]`;
const read = (files: Record<string, string>) => (file: string) => {
  assert.ok(Object.hasOwn(files, file), `fixture missing ${file}`);
  return files[file];
};

test("lint inheritance preserves first-party success and every whole violation in both modes", () => {
  const files = {
    "Cargo.toml": root(["crates/good", "crates/bad", "vendor/first_party"]),
    "crates/good/Cargo.toml": joined,
    "crates/bad/Cargo.toml": "[package]\nname = 'bad'\n",
    "vendor/first_party/Cargo.toml": "not TOML",
  };
  const summary = "workspace lints: 1/3 members joined, 2 pending\n";
  const problems = ["crates/bad", "vendor/first_party"].map(
    (member) => `${member} must add \`[lints] workspace = true\` (or be listed in PENDING)`,
  );
  assert.deepEqual(runWorkspaceLints(true, read(files)), {
    status: 1,
    stdout: summary,
    stderr: problems.join("\n") + "\n",
  });
  assert.deepEqual(runWorkspaceLints(false, read(files)), {
    status: 0,
    stdout: summary + problems.map((p) => `  ${p}\n`).join(""),
    stderr: "",
  });
  assert.deepEqual(
    runWorkspaceLints(
      true,
      read({ "Cargo.toml": root(["crates/good"]), "crates/good/Cargo.toml": joined }),
    ),
    {
      status: 0,
      stdout: "workspace lints: 1/1 members joined, 0 pending\n",
      stderr: "",
    },
  );
});

test("only the original five and six checked upstream SDK members are exempt", () => {
  const upstream = [
    "oxc_parser",
    "oxc_formatter",
    "oxlint_html_renderer186",
    "lightningcss",
    "parcel_sourcemap",
    "corsa_core",
    "corsa_jsonrpc",
    "corsa_client",
    "corsa_lsp",
    "corsa_orchestrator",
    "corsa",
  ];
  const members = [...upstream.map((name) => `vendor/${name}`), "crates/good"];
  const calls: string[] = [];
  const output = runWorkspaceLints(true, (file) => {
    calls.push(file);
    if (file === "Cargo.toml") return root(members);
    assert.equal(file, "crates/good/Cargo.toml");
    return joined;
  });
  assert.deepEqual(output, {
    status: 0,
    stdout: "workspace lints: 1/1 members joined, 0 pending\n",
    stderr: "",
  });
  assert.deepEqual(calls, ["Cargo.toml", "crates/good/Cargo.toml"]);
});

test("missing members, malformed root and absent root fail with whole original failure output", () => {
  assert.deepEqual(
    runWorkspaceLints(true, (file) => {
      if (file === "Cargo.toml") return root(["crates/absent"]);
      throw new Error("controlled missing member");
    }),
    { status: 1, stdout: "", stderr: "crates/absent/Cargo.toml: controlled missing member\n" },
  );
  for (const malformed of ["", "[workspace]\nnot_members = true", "members = []"])
    assert.deepEqual(
      runWorkspaceLints(true, () => malformed),
      { status: 1, stdout: "", stderr: "no workspace members found in Cargo.toml\n" },
    );
  assert.deepEqual(
    runWorkspaceLints(true, () => {
      throw new Error("controlled missing root");
    }),
    { status: 1, stdout: "", stderr: "Cargo.toml: controlled missing root\n" },
  );
});

test("the shrinking pending ratchet and exact lint-table admission remain enforced", () => {
  assert.deepEqual(
    runWorkspaceLints(
      true,
      read({ "Cargo.toml": root(["crates/good"]), "crates/good/Cargo.toml": joined }),
      ["crates/good", "crates/absent"],
    ),
    {
      status: 1,
      stdout: "workspace lints: 0/1 members joined, 1 pending\n",
      stderr:
        "crates/good opted into the workspace lints; remove it from PENDING\ncrates/absent is in PENDING but is not a workspace member\n",
    },
  );
  for (const malformed of [
    "[package]\nworkspace = true",
    "[lints]\nworkspace = false",
    "[lints]\n[lints.clippy]\nworkspace = true",
    "[lints]\nworkspace = true # comment",
  ])
    assert.equal(
      runWorkspaceLints(
        true,
        read({ "Cargo.toml": root(["crates/bad"]), "crates/bad/Cargo.toml": malformed }),
      ).status,
      1,
    );
});
