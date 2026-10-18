import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path, { join } from "node:path";
import { test } from "node:test";

import {
  createArchiveReceipt,
  verifyArchiveReceipt,
  validateCohortBuildReceipt,
  verifyCohortArchive,
  verifyCohortExecution,
  verifyCohortFiles,
} from "../../tools/support/compat/github/rust-test-archive.ts";
import {
  RUST_TEST_COHORTS,
  rustTestCohortForBinary,
} from "../../tools/support/compat/github/rust-test-cohorts.ts";
import { requireRustTier } from "../../tools/support/compat/github/require-rust-tier.ts";

void test("Rust archives reject different source, baked paths, runner, nextest, and contents", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "vize-rust-archive-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.name", "CI Test");
    git("config", "user.email", "ci@example.invalid");
    writeFileSync(join(cwd, "fixture"), "source\n");
    writeFileSync(join(cwd, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.99.1"\n');
    git("add", ".");
    git("commit", "-qm", "fixture");
    const archive = join(cwd, "tests.tar.zst");
    writeFileSync(archive, "archive bytes");
    const context = {
      cwd,
      nextestVersion: "cargo-nextest 0.9.146",
      rustcVersion: "rustc 1.99.1 (fixture)",
      env: { VIZE_TEST_REQUIRE_TSGO: "1", VIZE_NUXT_CONFIG_ITERATIONS: "100" },
    };
    const receipt = await createArchiveReceipt(archive, context);
    await assert.rejects(
      createArchiveReceipt(archive, { ...context, rustcVersion: "rustc 1.98.0 (old producer)" }),
      /pinned CI toolchain and TSGO runtime envelope/,
    );
    await assert.rejects(
      createArchiveReceipt(archive, { ...context, rustcVersion: "rustc 1.99.0 (old patch)" }),
      /pinned CI toolchain and TSGO runtime envelope/,
    );
    // An uncommitted downgrade cannot change the source authority.
    writeFileSync(join(cwd, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.99.0"\n');
    await verifyArchiveReceipt(receipt, archive, context);
    writeFileSync(join(cwd, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.99.1"\n');
    for (const key of [
      "schemaVersion",
      "sha",
      "tree",
      "workspaceRoot",
      "platform",
      "arch",
      "nextestVersion",
      "rustcVersion",
      "cargoProfile",
      "requireTsgo",
      "disableTsgo",
      "nuxtIterations",
      "archiveSha256",
    ]) {
      await assert.rejects(
        verifyArchiveReceipt({ ...receipt, [key]: "different" }, archive, context),
        { message: `Rust test archive ${key} mismatch` },
      );
    }
    await assert.rejects(
      verifyArchiveReceipt(receipt, archive, {
        ...context,
        env: { VIZE_TEST_DISABLE_TSGO: "1", VIZE_NUXT_CONFIG_ITERATIONS: "100" },
      }),
      { message: "Rust test archive requireTsgo mismatch" },
    );
    for (const env of [
      {},
      {
        VIZE_TEST_REQUIRE_TSGO: "1",
        VIZE_TEST_DISABLE_TSGO: "",
        VIZE_NUXT_CONFIG_ITERATIONS: "100",
      },
      {
        VIZE_TEST_REQUIRE_TSGO: "",
        VIZE_TEST_DISABLE_TSGO: "1",
        VIZE_NUXT_CONFIG_ITERATIONS: "100",
      },
      {
        VIZE_TEST_REQUIRE_TSGO: "1",
        VIZE_TEST_DISABLE_TSGO: "1",
        VIZE_NUXT_CONFIG_ITERATIONS: "100",
      },
    ]) {
      await assert.rejects(
        createArchiveReceipt(archive, { ...context, env }),
        /pinned CI toolchain and TSGO runtime envelope/,
      );
    }
    writeFileSync(archive, "corrupted bytes");
    await assert.rejects(verifyArchiveReceipt(receipt, archive, context), {
      message: "Rust test archive archiveSha256 mismatch",
    });
    writeFileSync(join(cwd, "fixture"), "different source\n");
    git("add", "fixture");
    git("commit", "-qm", "changed source");
    await assert.rejects(verifyArchiveReceipt(receipt, archive, context), {
      message: "Rust test archive sha mismatch",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

void test("Rust tier gate rejects failed, cancelled, absent, and skipped required shards", () => {
  const success = { result: "success" };
  const needs = {
    "merge-rust-source": success,
    "merge-rust-differential": success,
    "pr-rust-build": success,
    "pr-rust-shard": success,
  };
  assert.equal(requireRustTier("pull_request", "true", needs).exitCode, 0);
  for (const [event, jobs] of [
    ["pull_request", ["pr-rust-build", "pr-rust-shard"]],
    [
      "merge_group",
      ["merge-rust-source", "merge-rust-differential", "pr-rust-build", "pr-rust-shard"],
    ],
  ]) {
    assert.equal(requireRustTier(event, "true", needs).exitCode, 0);
    for (const job of jobs) {
      for (const result of ["failure", "cancelled", "skipped", "unknown"]) {
        assert.equal(requireRustTier(event, "true", { ...needs, [job]: { result } }).exitCode, 1);
      }
      const absent = { ...needs };
      delete absent[job];
      assert.throws(() => requireRustTier(event, "true", absent), {
        message: `Missing Rust tier job: ${job}`,
      });
      for (const result of [undefined, null, {}]) {
        assert.throws(() => requireRustTier(event, "true", { ...needs, [job]: result }), {
          message: `Job ${job} reported no result in the needs context`,
        });
      }
    }
  }
  assert.equal(
    requireRustTier("merge_group", "true", { ...needs, "merge-rust-source": { result: "skipped" } })
      .exitCode,
    1,
  );
  for (const event of ["pull_request", "merge_group"])
    for (const plan of ["false", "", undefined, null, false, true, {}, "TRUE"])
      assert.throws(() => requireRustTier(event, plan, needs), {
        message: "Rust source checks must run for every pull request and merge group",
      });
  for (const event of ["push", "schedule", "workflow_dispatch", "workflow_call", "", null])
    assert.throws(() => requireRustTier(event, "true", needs), {
      message: "Unexpected Rust tier event",
    });
});

void test("archive compiler authority follows the exact committed reviewed patch", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "vize-rust-archive-toolchain-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "CI Test");
  git("config", "user.email", "ci@example.invalid");
  const archive = join(cwd, "tests.tar.zst");
  writeFileSync(archive, "archive bytes");
  for (const channel of ["1.99.0", "1.99.1", "1.99.2", "stable"]) {
    writeFileSync(join(cwd, "rust-toolchain.toml"), `[toolchain]\nchannel = "${channel}"\n`);
    git("add", "rust-toolchain.toml");
    git("commit", "-qm", `test: source Rust ${channel}`);
    const context = {
      cwd,
      nextestVersion: "cargo-nextest 0.9.146",
      rustcVersion: `rustc ${channel} (fixture)`,
      env: { VIZE_TEST_REQUIRE_TSGO: "1", VIZE_NUXT_CONFIG_ITERATIONS: "100" },
    };
    if (["1.99.0", "1.99.1"].includes(channel)) {
      const receipt = await createArchiveReceipt(archive, context);
      await verifyArchiveReceipt(receipt, archive, context);
      await assert.rejects(
        createArchiveReceipt(archive, {
          ...context,
          rustcVersion: `rustc ${channel}-nightly (fixture)`,
        }),
        /pinned CI toolchain/,
      );
    } else {
      await assert.rejects(
        createArchiveReceipt(archive, context),
        /reviewed committed source toolchain/,
      );
    }
  }
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => structuredClone(value);
const xml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

async function cohortFixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "vize-cohort-receipt-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Archive Fixture");
  git("config", "user.email", "archive@example.invalid");
  writeFileSync(path.join(cwd, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.99.1"\n');
  git("add", "rust-toolchain.toml");
  git("commit", "-qm", "fixture");
  const context = {
    cwd,
    nextestVersion: "cargo-nextest 0.9.146 (fixture)",
    rustcVersion: "rustc 1.99.1 (fixture)",
    env: {
      VIZE_TEST_REQUIRE_TSGO: "1",
      VIZE_NUXT_CONFIG_ITERATIONS: "100",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
    },
  };
  const inventory = [
    ["vize_l0", "vize_l0"],
    ["vize_canon", "diagnostics"],
    ["vize_maestro", "vize_maestro"],
    ["vize_glyph", "format"],
    ["vize", "vize"],
    ["vize", "lsp_future"],
  ].map(([pkg, binary]) => ({
    id: `${pkg}::${binary}`,
    package: pkg,
    binary,
    cases: [
      { name: 'module::case<&"Ω', ignored: false },
      { name: "module::ignored", ignored: true },
    ],
  }));
  inventory.push({ id: "empty", package: "vize_l1", binary: "empty", cases: [] });
  const write = (relative, contents) => {
    const absolute = path.join(cwd, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
    return { path: relative, sha256: sha256(contents) };
  };
  const resources = [
    "target/ci/helper-exe",
    "target/ci/build/fixture/out/generated",
    "target/ci/deps/shared.so",
    "target/nextest/libdirs/host/libstd-fixture.so",
    "target/ci/fixture/included-resource",
  ].map((file) => write(file, `inert resource: ${file}`));
  const archives = new Map();
  const payloads = RUST_TEST_COHORTS.map(({ id: cohort, filter }) => {
    const binaries = inventory.filter(
      (item) => rustTestCohortForBinary(item.package, item.binary) === cohort,
    );
    const binaryFiles = binaries.map((item, index) => ({
      id: item.id,
      ...write(`target/ci/deps/${cohort}-${index}`, `inert binary: ${item.id}`),
    }));
    const archive = path.join(cwd, `${cohort}.tar.zst`);
    writeFileSync(archive, `inert archive: ${cohort}`);
    archives.set(cohort, archive);
    return {
      cohort,
      filter,
      archiveSha256: sha256(readFileSync(archive)),
      binaryIds: binaries.map((item) => item.id),
      binaryFiles,
      files: [...binaryFiles.map(({ path, sha256 }) => ({ path, sha256 })), ...resources],
    };
  });
  const legacy = await createArchiveReceipt(archives.get("compiler"), context);
  const { archiveSha256: _, ...source } = legacy;
  const common = {
    ...source,
    schemaVersion: 4,
    producerRun: "123",
    producerAttempt: 2,
    inventory,
    payloads,
  };
  const junit = (cohort) =>
    `<testsuites>${inventory
      .filter((item) => rustTestCohortForBinary(item.package, item.binary) === cohort)
      .flatMap((item) =>
        item.cases
          .filter((entry) => !entry.ignored)
          .map((entry) => `<testcase classname="${xml(item.id)}" name="${xml(entry.name)}"/>`),
      )
      .join("")}</testsuites>`;
  return { cwd, context, common, legacy, archives, junit };
}

void test("common schema 4 preserves five payloads, empty binaries and ignored identities", async (t) => {
  const fixture = await cohortFixture(t);
  const { common, context, archives, cwd, junit } = fixture;
  assert.equal(validateCohortBuildReceipt(common), common);
  assert.equal(common.inventory.length, 7);
  assert.equal(common.payloads.flatMap((item) => item.binaryIds).length, 7);
  assert.equal(common.inventory.filter((item) => item.cases.length === 0).length, 1);
  for (const { cohort } of common.payloads) {
    await verifyCohortArchive(common, archives.get(cohort), cohort, context);
    verifyCohortFiles(common, cohort, cwd);
    verifyCohortExecution(common, cohort, junit(cohort));
  }
  assert.equal(
    common.inventory.flatMap((item) => item.cases).filter((item) => item.ignored).length,
    6,
  );
  await verifyArchiveReceipt(fixture.legacy, archives.get("compiler"), context);
  assert.throws(() => validateCohortBuildReceipt(fixture.legacy), /schema 4/);
});

void test("common receipt refuses missing, duplicate, foreign or changed cohort custody", async (t) => {
  const { common } = await cohortFixture(t);
  const mutations = {
    "unknown schema": (copy) => {
      copy.schemaVersion = 5;
    },
    "missing cohort": (copy) => {
      copy.payloads.pop();
    },
    "duplicate cohort": (copy) => {
      copy.payloads[1].cohort = "compiler";
    },
    "foreign cohort": (copy) => {
      copy.payloads[0].cohort = "future";
    },
    "changed filter": (copy) => {
      copy.payloads[0].filter = "all()";
    },
    "missing binary": (copy) => {
      copy.inventory.shift();
    },
    "duplicate binary": (copy) => {
      copy.inventory.push(copy.inventory[0]);
    },
    "foreign package": (copy) => {
      copy.inventory[0].package = "vize_future";
    },
    "duplicate test": (copy) => {
      copy.inventory[0].cases.push(copy.inventory[0].cases[0]);
    },
    "invalid ignored": (copy) => {
      copy.inventory[0].cases[0].ignored = "false";
    },
    "empty test name": (copy) => {
      copy.inventory[0].cases[0].name = "";
    },
    "foreign binary selection": (copy) => {
      copy.payloads[0].binaryIds.push("foreign");
    },
    "missing binary mapping": (copy) => {
      copy.payloads[0].binaryFiles.pop();
    },
    "foreign binary mapping": (copy) => {
      copy.payloads[0].binaryFiles[0].id = "foreign";
    },
    "changed binary mapping hash": (copy) => {
      copy.payloads[0].binaryFiles[0].sha256 = "a".repeat(64);
    },
    "missing binary file": (copy) => {
      copy.payloads[0].files.shift();
    },
    "duplicate resource": (copy) => {
      copy.payloads[0].files.push(copy.payloads[0].files[0]);
    },
    "escaping resource": (copy) => {
      copy.payloads[0].files[0].path = "target/../outside";
    },
    "bad archive hash": (copy) => {
      copy.payloads[0].archiveSha256 = "wrong";
    },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const copy = clone(common);
    mutate(copy);
    assert.throws(() => validateCohortBuildReceipt(copy), undefined, label);
  }
});

void test("payload admission binds actual archive, source, run and runtime envelope", async (t) => {
  const { common, archives, context } = await cohortFixture(t);
  const archive = archives.get("compiler");
  await assert.rejects(
    verifyCohortArchive(common, archives.get("typechecker"), "compiler", context),
  );
  await assert.rejects(verifyCohortArchive(common, archive, "foreign", context));
  for (const field of [
    "sha",
    "tree",
    "workspaceRoot",
    "platform",
    "arch",
    "cargoProfile",
    "requireTsgo",
    "nuxtIterations",
  ]) {
    const copy = clone(common);
    copy[field] = "changed";
    await assert.rejects(verifyCohortArchive(copy, archive, "compiler", context), undefined, field);
  }
  await assert.rejects(
    verifyCohortArchive(common, archive, "compiler", {
      ...context,
      nextestVersion: "cargo-nextest 0.9.147 (fixture)",
    }),
  );
  await assert.rejects(
    verifyCohortArchive(common, archive, "compiler", {
      ...context,
      rustcVersion: "rustc 1.99.0 (fixture)",
    }),
  );
  for (const env of [
    { ...context.env, GITHUB_RUN_ID: "124" },
    { ...context.env, GITHUB_RUN_ATTEMPT: "1" },
    { ...context.env, VIZE_TEST_DISABLE_TSGO: "1" },
    { ...context.env, VIZE_NUXT_CONFIG_ITERATIONS: "99" },
  ])
    await assert.rejects(verifyCohortArchive(common, archive, "compiler", { ...context, env }));
  writeFileSync(archive, "changed archive bytes");
  await assert.rejects(
    verifyCohortArchive(common, archive, "compiler", context),
    /digest mismatch/,
  );
});

void test("extracted binary and resource bytes must remain present and unchanged", async (t) => {
  const { common, cwd } = await cohortFixture(t);
  for (const file of common.payloads[0].files) {
    const absolute = path.join(cwd, file.path);
    const original = readFileSync(absolute);
    writeFileSync(absolute, "changed extracted bytes");
    assert.throws(() => verifyCohortFiles(common, "compiler", cwd), /changed/);
    rmSync(absolute);
    assert.throws(() => verifyCohortFiles(common, "compiler", cwd), /ENOENT/);
    writeFileSync(absolute, original);
  }
  verifyCohortFiles(common, "compiler", cwd);
});

void test("execution requires exact binary and test names, statuses and ignored disposition", async (t) => {
  const { common, junit } = await cohortFixture(t);
  const original = junit("compiler");
  const caseTag = original.match(/<testcase\b[^>]*\/>/)[0];
  for (const changed of [
    original.replace(caseTag, ""),
    original.replace(caseTag, caseTag + caseTag),
    original.replace("module::case", "module::different"),
    original.replace("vize_l0::vize_l0", "foreign::binary"),
    original.replace("/>", "><failure/></testcase>"),
    original.replace("/>", "><error/></testcase>"),
    original.replace("/>", "><skipped/></testcase>"),
    original.replace(
      "</testsuites>",
      '<testcase classname="vize_l0::vize_l0" name="module::ignored"/></testsuites>',
    ),
  ])
    assert.throws(() => verifyCohortExecution(common, "compiler", changed));
  for (const mutate of [
    (copy) => {
      copy.inventory[0].cases.shift();
    },
    (copy) => {
      copy.inventory[0].cases.push({ name: "future::case", ignored: false });
    },
    (copy) => {
      copy.inventory[0].cases[0].ignored = true;
    },
    (copy) => {
      copy.inventory[0].cases[1].ignored = false;
    },
  ]) {
    const copy = clone(common);
    mutate(copy);
    assert.throws(() => verifyCohortExecution(copy, "compiler", original));
  }
  verifyCohortExecution(
    common,
    "compiler",
    original.replace("</testsuites>", "<![CDATA[<failure/>]]><!-- <testcase/> --></testsuites>"),
  );
});
