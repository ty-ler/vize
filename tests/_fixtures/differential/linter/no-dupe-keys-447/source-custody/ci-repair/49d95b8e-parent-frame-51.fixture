import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  noMutatingCallerAncestryCapsulePath,
  noMutatingCallerAncestryCapsuleSHA256,
  seedNoMutatingCallerAncestry,
  verifyNoMutatingCallerAncestryCapsule,
} from "./support/no-mutating-props-current-caller-ancestry.mjs";
import { authenticateNoMutatingCurrentCallerSource } from "./support/no-mutating-props-current-caller-source-custody.mjs";
import { authenticateNoMutatingCallerFrame } from "./support/no-mutating-props-current-caller-frame.mjs";
import { privateNoMutatingCallerGit } from "./support/no-mutating-props-current-caller-git.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const directory =
  "tests/_fixtures/differential/linter/no-mutating-props-options-uploader/source-custody/current-callers/ancestry-b48";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const read = (name) => fs.readFileSync(path.join(root, name));
const git = (cwd, args, input) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    cwd,
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
const capsule = JSON.parse(gunzipSync(read(noMutatingCallerAncestryCapsulePath)));
const positive = () => verifyNoMutatingCallerAncestryCapsule(capsule);

void test("all138 complete raw objects and each rooted path/first-parent edge refuse changed custody", () => {
  assert.equal(
    sha(read(noMutatingCallerAncestryCapsulePath)),
    noMutatingCallerAncestryCapsuleSHA256,
  );
  assert.equal(positive().size, 138);
  let controls = 0;
  for (const [index] of capsule.objects.entries()) {
    for (const mutate of [
      (copy) => copy.objects.splice(index, 1),
      (copy) => {
        copy.objects[index].base64 = Buffer.from("foreign raw object").toString("base64");
      },
      (copy) => {
        copy.objects[index].type = "foreign";
      },
    ]) {
      const copy = structuredClone(capsule);
      mutate(copy);
      assert.throws(() => verifyNoMutatingCallerAncestryCapsule(copy));
      controls++;
    }
    assert.equal(positive().size, 138);
  }
  for (const [index] of capsule.firstParentCommits.entries()) {
    const copy = structuredClone(capsule);
    copy.firstParentCommits[index] = "0".repeat(40);
    assert.throws(() => verifyNoMutatingCallerAncestryCapsule(copy));
    assert.equal(positive().size, 138);
    controls++;
  }
  for (const [scopeIndex, scope] of capsule.sourceScopes.entries()) {
    for (const [index, [, expected]] of scope.files.entries()) {
      const copy = structuredClone(capsule);
      copy.sourceScopes[scopeIndex].files[index][1] = expected === null ? "0".repeat(40) : null;
      assert.throws(() => verifyNoMutatingCallerAncestryCapsule(copy));
      controls++;
    }
    assert.equal(positive().size, 138);
    const copy = structuredClone(capsule);
    copy.sourceScopes[scopeIndex].rootTree = "0".repeat(40);
    assert.throws(() => verifyNoMutatingCallerAncestryCapsule(copy));
  }
  assert.equal(controls, 542);
  assert.throws(() =>
    verifyNoMutatingCallerAncestryCapsule({
      ...capsule,
      objects: [...capsule.objects, capsule.objects[0]],
    }),
  );
  assert.equal(positive().size, 138);
});

void test("fixed external source law preserves wholeB48 helper/cases and the unchanged current23 refusal", () => {
  const bytes = read(directory + "/successor.json");
  assert.equal(sha(bytes), "6e085dbefe5bdd29bad998abaf5f6763beaae71542bd06b9f83b8dd8a081c1bf");
  const declaration = JSON.parse(bytes);
  assert.equal(declaration.predecessorSource, "b48dbb85e257f1875a4df83113dfb20f4830e3a2");
  assert.equal(
    declaration.primaryManifestSHA256,
    "90d02914213ad8346bdd4a71488dd322591d0ab7dcb9588117f5ccba5caff1b9",
  );
  for (const item of declaration.currentBodies) {
    const body = read(item.path);
    assert.equal(body.length, item.bytes);
    assert.equal(sha(body), item.sha256);
  }
  for (const item of declaration.successors) {
    const original = read(item.before.archive);
    assert.equal(sha(original), item.before.sha256);
    assert.equal(original.length, item.before.bytes);
    let inverse = read(item.path).toString();
    for (const change of item.inverse) {
      assert.equal(inverse.split(change.after).length, 2);
      inverse = inverse.replace(change.after, change.before);
    }
    assert.deepEqual(Buffer.from(inverse), original);
  }
  const current = authenticateNoMutatingCurrentCallerSource(root);
  assert.equal(current.completeCurrentBodies, 23);
  assert.equal(current.oldMeasurement, null);
  assert.equal(current.oldSetup, null);
  assert.equal(current.performance, false);
  assert.equal(
    current.manifest.historicalFrame.sha256,
    capsule.completeHistoricalPhysicalFrameSHA256,
  );
  // This external law's executing bytes are sealed by the complete independent source peer.
});

function seedHistoricalHead(owned, sourceGit, bodies) {
  const head = capsule.head;
  const commit = git(sourceGit, ["cat-file", "commit", head]);
  assert.equal(
    git(owned, ["hash-object", "-w", "-t", "commit", "--stdin"], commit).toString().trim(),
    head,
  );
  const rootTree = /^tree ([a-f0-9]{40})\n/u.exec(commit.toString())[1];
  const trees = new Map();
  const entries = (id) => {
    if (!trees.has(id)) {
      const body = git(sourceGit, ["cat-file", "tree", id]);
      assert.equal(
        git(owned, ["hash-object", "-w", "-t", "tree", "--stdin"], body).toString().trim(),
        id,
      );
      const listing = git(sourceGit, ["ls-tree", "-z", id]).toString().split("\0").filter(Boolean);
      trees.set(
        id,
        new Map(
          listing.map((line) => {
            const match = /^(\d+) (tree|blob|commit) ([a-f0-9]{40})\t(.+)$/u.exec(line);
            assert(match);
            return [match[4], { mode: match[1], id: match[3] }];
          }),
        ),
      );
    }
    return trees.get(id);
  };
  for (const [name, body] of bodies) {
    const parts = name.split("/");
    let current = rootTree;
    for (const [position, part] of parts.entries()) {
      const entry = entries(current).get(part);
      assert(entry);
      assert.equal(entry.mode, position === parts.length - 1 ? "100644" : "040000");
      current = entry.id;
    }
    assert.equal(
      git(owned, ["hash-object", "-w", "-t", "blob", "--stdin"], body).toString().trim(),
      current,
    );
    const file = path.join(owned, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o644, flag: "wx" });
  }
  fs.writeFileSync(path.join(owned, ".git/HEAD"), head + "\n");
  fs.writeFileSync(path.join(owned, ".git/shallow"), head + "\n");
}

void test("the unchanged whole5 Nodeep cases pass in real sparse raw2489 context with a dead origin after seeding", () => {
  const context = authenticateNoMutatingCurrentCallerSource(root);
  const bodies = authenticateNoMutatingCallerFrame(root, context.manifest);
  assert.equal(bodies.size, 425);
  const originalLaw = context.manifest.laws.find(({ path: name }) =>
    name.endsWith("git-reader-nodeep.test.ts"),
  );
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-mutating-literal-ancestry-"));
  try {
    git(owned, ["init", "--quiet"]);
    const deadOrigin = path.join(owned, "never-created-origin");
    git(owned, ["remote", "add", "origin", deadOrigin]);
    seedHistoricalHead(owned, privateNoMutatingCallerGit(root, capsule.head), bodies);
    const missing = git(
      owned,
      ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
      capsule.firstParentCommits.slice(1).join("\n") + "\n",
    ).toString();
    assert(
      missing
        .split("\n")
        .filter(Boolean)
        .every((line) => line.endsWith(" missing")),
    );
    const boundary = fs.readFileSync(path.join(owned, ".git/shallow"));
    assert.equal(seedNoMutatingCallerAncestry(root, owned).rawObjects, 138);
    assert.equal(git(owned, ["remote", "get-url", "origin"]).toString().trim(), deadOrigin);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
    const result = spawnSync(
      process.execPath,
      ["--test", "--test-reporter=tap", originalLaw.path],
      { cwd: owned, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
    );
    const packet = path.join(
      root,
      "target/differential/no-mutating-current-callers/ancestry-b48-original5-dead-origin.json",
    );
    fs.mkdirSync(path.dirname(packet), { recursive: true });
    fs.writeFileSync(
      packet,
      JSON.stringify(
        {
          source: capsule.head,
          originalWholeLawSHA256: originalLaw.sha256,
          completePhysicalFrameRows: bodies.size,
          capsuleSHA256: noMutatingCallerAncestryCapsuleSHA256,
          beforeMissingCommitLookup: missing,
          deadOrigin,
          status: result.status,
          signal: result.signal,
          error: result.error?.message ?? null,
          stdout: result.stdout,
          stderr: result.stderr,
          sourceOnly: true,
          native: false,
          performance: false,
        },
        null,
        2,
      ) + "\n",
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.signal, null);
    for (const line of ["# tests 5", "# pass 5", "# fail 0", "# skipped 0"])
      assert(result.stdout.split("\n").includes(line));
    assert.deepEqual(fs.readFileSync(path.join(owned, ".git/shallow")), boundary);
    for (const name of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_OBJECT_DIRECTORY",
      "GIT_INDEX_FILE",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ]) {
      const previous = process.env[name];
      process.env[name] = root;
      try {
        assert.throws(() => seedNoMutatingCallerAncestry(root, owned), /path override/u);
      } finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
      assert.equal(seedNoMutatingCallerAncestry(root, owned).rawObjects, 138);
    }
    const parent = capsule.firstParentCommits[1];
    const objectFile = path.join(owned, ".git/objects", parent.slice(0, 2), parent.slice(2));
    const originalObject = fs.readFileSync(objectFile);
    fs.unlinkSync(objectFile);
    assert.throws(() => seedNoMutatingCallerAncestry(root, owned));
    fs.writeFileSync(objectFile, originalObject, { mode: 0o444 });
    assert.equal(seedNoMutatingCallerAncestry(root, owned).rawObjects, 138);
    const sourceCopy = path.join(owned, "source-capsule-control");
    const sourceFile = path.join(sourceCopy, noMutatingCallerAncestryCapsulePath);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      Buffer.concat([read(noMutatingCallerAncestryCapsulePath), Buffer.from("foreign suffix")]),
    );
    assert.throws(() => seedNoMutatingCallerAncestry(sourceCopy, owned));
    fs.writeFileSync(sourceFile, read(noMutatingCallerAncestryCapsulePath));
    assert.equal(seedNoMutatingCallerAncestry(sourceCopy, owned).rawObjects, 138);
    const objects = path.join(owned, ".git/objects");
    fs.renameSync(objects, objects + "-preserved");
    fs.symlinkSync(objects + "-preserved", objects);
    assert.throws(() => seedNoMutatingCallerAncestry(root, owned));
    fs.unlinkSync(objects);
    fs.renameSync(objects + "-preserved", objects);
    assert.equal(seedNoMutatingCallerAncestry(root, owned).rawObjects, 138);
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});
