import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { primeStarCounterpartHistory } from "../../tools/support/compat/github/source-counterpart-snapshot.mjs";
import {
  authenticateStarListingSource,
  qualifyStarListingBD,
  starListingLexicalReader,
} from "../../tools/support/compat/github/empty-vue-star-listing-source.mjs";

const root = fs.realpathSync(new URL("../../", import.meta.url));
const manifestPath = "tools/support/compat/github/empty-vue-star-listing-source.json";
const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath)));
const rows = manifest.parts.flatMap(([file]) => JSON.parse(fs.readFileSync(path.join(root, file))));
const executing = [manifestPath, ...manifest.parts.map(([file]) => file), ...manifest.executing];
const files = [...rows.map(([file]) => file), ...executing];
const execution = "crates/vize_canon/tests/empty_vue_star_exports/execution.rs";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const pairs = new Map(rows.map(([file, , , before, , , after]) => [file, { before, after }]));
for (const file of executing)
  pairs.set(file, { before: null, after: sha(fs.readFileSync(path.join(root, file))) });
const digest = (side, file) => pairs.get(file)?.[side] ?? null;
const git = (owner, args, input) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    cwd: owner,
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
  });
function fixture(run) {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), "vize-star-listing-refusals-"));
  try {
    git(owner, ["init", "--quiet"]);
    const common = git(root, ["rev-parse", "--git-common-dir"]).toString().trim();
    fs.writeFileSync(
      path.join(owner, ".git/objects/info/alternates"),
      fs.realpathSync(path.resolve(root, common, "objects")) + "\n",
    );
    const head = git(root, ["rev-parse", "HEAD"]).toString().trim();
    git(owner, ["read-tree", head]);
    git(owner, ["update-ref", "refs/heads/current", head]);
    git(owner, ["symbolic-ref", "HEAD", "refs/heads/current"]);
    for (const file of files) {
      const target = path.join(owner, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
      fs.chmodSync(target, 0o644);
    }
    run(owner, head);
  } finally {
    fs.rmSync(owner, { recursive: true, force: true });
  }
}

await test("the actual BD union admits only one production path after complete current raw source custody", () => {
  const packet = authenticateStarListingSource(root);
  assert.equal(packet.originalStarBodies, 322);
  assert.equal(packet.originalJSBodies, 93);
  assert.equal(packet.runtimeCredit, false);
  assert.equal(packet.original400Credit, false);
  const requestedBase = "c4f74b48fb2df6ea20aeb414193d82f531ab059e";
  const head = git(root, ["rev-parse", "HEAD"]).toString().trim();
  const baseline = git(root, ["merge-base", requestedBase, head]).toString().trim();
  assert.equal(baseline, requestedBase, "reviewed shipping cut is actual ancestor");
  assert.match(baseline, /^[a-f0-9]{40}$/u);
  assert.equal(git(root, ["merge-base", manifest.base, baseline]).toString().trim(), manifest.base);
  assert.equal(git(root, ["merge-base", manifest.base, head]).toString().trim(), manifest.base);
  // Authenticate the real owner graph independently of the fixed BD source cohort.
  const graph = git(root, ["rev-list", "--parents", baseline, head, "^" + manifest.base])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "));
  graph.push([
    manifest.base,
    ...git(root, ["cat-file", "commit", manifest.base])
      .toString()
      .split("\n\n", 1)[0]
      .split("\n")
      .filter((line) => line.startsWith("parent "))
      .map((line) => line.slice(7)),
  ]);
  const shallowPath = git(root, ["rev-parse", "--git-path", "shallow"]).toString().trim();
  const shallow = new Set(
    fs.existsSync(path.resolve(root, shallowPath))
      ? fs.readFileSync(path.resolve(root, shallowPath), "utf8").trim().split("\n")
      : [],
  );
  for (const [id, ...parents] of graph) {
    assert.equal(shallow.has(id), false, "complete actual comparison ancestry");
    const body = git(root, ["cat-file", "commit", id]);
    assert.equal(
      createHash("sha1").update(`commit ${body.length}\0`).update(body).digest("hex"),
      id,
    );
    const actualParents = body
      .toString()
      .split("\n\n", 1)[0]
      .split("\n")
      .filter((line) => line.startsWith("parent "))
      .map((line) => line.slice(7));
    assert.deepEqual(actualParents, parents, "genuine complete actual parent edges");
  }
  const production = git(root, [
    "diff",
    "--name-only",
    baseline,
    head,
    "--",
    "crates",
    "davinci",
    "vendor",
    "npm",
    "Cargo.toml",
    "Cargo.lock",
    ".cargo",
    ".config",
    "rust-toolchain.toml",
  ])
    .toString()
    .trim()
    .split("\n");
  assert.deepEqual(production, [execution]);
  assert.deepEqual(qualifyStarListingBD(production, new Set(), digest)?.files, production);
});

await test("every complete BD counterpart and executing body on both sides refuses drift and absence", () => {
  for (const file of files)
    for (const side of ["before", "after"])
      for (const value of [null, "f".repeat(64)]) {
        if (value === digest(side, file)) continue;
        assert.equal(
          qualifyStarListingBD([execution], new Set(), (s, name) =>
            s === side && name === file ? value : digest(s, name),
          ),
          null,
          side + ":" + file,
        );
      }
  for (const footprint of [
    [],
    [execution, execution],
    [execution, "unknown.rs"],
    [execution, "crates/vize_canon/src/lib.rs"],
  ])
    for (const qualified of [
      new Set(),
      new Set(footprint),
      new Set(["crates/vize_canon/src/lib.rs"]),
    ])
      assert.equal(qualifyStarListingBD(footprint, qualified, digest), null);
  assert.equal(qualifyStarListingBD([execution], new Set([execution]), digest), null);
});

await test("foreign raw bodies, changed entrypoints, hybrid source, modes and replacement refs refuse before replay", () => {
  fixture((owner, head) => {
    assert(authenticateStarListingSource(owner));
    const readLexical = starListingLexicalReader(owner);
    for (const file of [
      "tests/performance/support/warm-type-backed-host-qualifications.ts",
      "tests/tooling/warm-type-backed-lexical-dollar-host.test.ts",
    ]) {
      assert.deepEqual(readLexical(file), git(root, ["show", manifest.base + ":" + file]));
      const target = path.join(owner, file),
        original = fs.readFileSync(target);
      fs.writeFileSync(target, Buffer.concat([original, Buffer.from("foreign copied source\n")]));
      assert.throws(() => readLexical(file));
      fs.writeFileSync(target, original);
    }
    assert.throws(() => readLexical("unknown.ts"));
    assert.throws(() => readLexical(execution));
    readLexical.confirmSource();
    for (const file of [
      execution,
      "tests/performance/support/warm-type-backed-host-qualifications.ts",
      manifest.tests[0][0],
      "tests/tooling/javascript-sfc-star-source.test.mjs",
      "tests/tooling/javascript-sfc-options-source.test.mjs",
      "tests/tooling/warm-type-backed-lexical-dollar-host.test.ts",
      manifest.executing[0],
      manifestPath,
    ]) {
      const target = path.join(owner, file),
        original = fs.readFileSync(target);
      fs.writeFileSync(target, Buffer.concat([original, Buffer.from("foreign source\n")]));
      assert.throws(() => authenticateStarListingSource(owner));
      fs.writeFileSync(target, original);
      fs.chmodSync(target, 0o755);
      assert.throws(() => authenticateStarListingSource(owner));
      fs.chmodSync(target, 0o644);
      const old = git(root, ["show", manifest.base + ":" + execution]);
      fs.writeFileSync(target, old);
      assert.throws(() => authenticateStarListingSource(owner));
      fs.writeFileSync(target, original);
    }
    const target = path.join(owner, execution),
      original = fs.readFileSync(target);
    git(owner, ["read-tree", head]);
    const changed = git(
      owner,
      ["hash-object", "-w", "--stdin"],
      Buffer.concat([original, Buffer.from("foreign committed source\n")]),
    )
      .toString()
      .trim();
    git(owner, ["update-index", "--cacheinfo", "100644," + changed + "," + execution]);
    const tree = git(owner, ["write-tree"]).toString().trim();
    const foreign = git(
      owner,
      [
        "-c",
        "user.name=Source refusal",
        "-c",
        "user.email=source@invalid.example",
        "commit-tree",
        tree,
        "-p",
        head,
      ],
      "foreign current source\n",
    )
      .toString()
      .trim();
    git(owner, ["update-ref", "refs/heads/current", foreign]);
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from("foreign committed source\n")]));
    assert.throws(() => authenticateStarListingSource(owner));
    git(owner, ["update-ref", "refs/heads/current", head]);
    fs.writeFileSync(target, original);
    git(owner, ["update-ref", "refs/replace/" + head, foreign]);
    assert.throws(() => authenticateStarListingSource(owner));
    git(owner, ["update-ref", "-d", "refs/replace/" + head]);
    assert(authenticateStarListingSource(owner));
  });
});

function coldPrimeFixture(run) {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), "vize-star-prime-mutex-"));
  try {
    git(owner, ["init", "--quiet"]);
    run(owner, path.join(owner, ".git/objects/info/star-counterpart-prime.lock"));
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(owner, { recursive: true, force: true });
  }
}
await test("a dead owned priming PID can be recovered without accepting a failed strict worker", () => {
  coldPrimeFixture((owner, lock) => {
    const dead = childProcess.spawnSync(process.execPath, ["-e", ""]);
    fs.writeFileSync(lock, dead.pid + ":1", { mode: 0o600 });
    let calls = 0;
    mock.method(childProcess, "spawnSync", (_command, args, options) => {
      calls++;
      assert(args[2].includes("ensureHostedLiteralSource"));
      assert(options.timeout <= 1500);
      return { status: 1, pid: undefined };
    });
    syncBuiltinESMExports();
    assert.throws(
      () => primeStarCounterpartHistory(owner, { timeoutMs: 1500 }),
      /bounded strict literal/u,
    );
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(lock), false);
  });
});
await test("a token ENOSPC failure still removes the lock acquired before its write", () => {
  coldPrimeFixture((owner, lock) => {
    const original = fs.writeFileSync;
    mock.method(fs, "writeFileSync", (target, ...args) => {
      if (typeof target === "number")
        throw Object.assign(new Error("controlled ENOSPC"), { code: "ENOSPC" });
      return original(target, ...args);
    });
    assert.throws(() => primeStarCounterpartHistory(owner), { code: "ENOSPC" });
    assert.equal(fs.existsSync(lock), false);
  });
});
await test("the owner worker deadline kills its real process group and preserves timeout failure", () => {
  coldPrimeFixture((owner, lock) => {
    const original = childProcess.spawnSync,
      mark = path.join(owner, "descendant.pid");
    const worker = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const d=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(mark)},String(d.pid)); setInterval(()=>{},1000);`;
    mock.method(childProcess, "spawnSync", (command, args, options) => {
      assert(args[2].includes("ensureHostedLiteralSource"));
      assert(options.detached);
      assert(options.timeout <= 1500);
      return original(command, ["-e", worker], options);
    });
    syncBuiltinESMExports();
    assert.throws(() => primeStarCounterpartHistory(owner, { timeoutMs: 1500 }), {
      code: "ETIMEDOUT",
    });
    const pid = Number(fs.readFileSync(mark, "utf8"));
    const state = original("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    assert(state.status !== 0 || state.stdout.trim().startsWith("Z"));
    assert.equal(fs.existsSync(lock), false);
  });
});
