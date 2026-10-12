import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { joinIdentity, joinSHA } from "./no-mutating-component-join-physical.mjs";
import { sourceCredit, sourcePath } from "./no-dupe-keys-common-main-source-physical.mjs";

import {
  validateCommonProcess,
  validateCommonNestedPacket,
} from "./no-dupe-keys-common-main-source-packets.mjs";
export {
  validateCommonProcess,
  validateCommonNestedPacket,
} from "./no-dupe-keys-common-main-source-packets.mjs";

function regularBytes(root, name) {
  const target = path.join(root, sourcePath(name));
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o644);
  assert.equal(fs.realpathSync(target), path.join(fs.realpathSync(root), name));
  return fs.readFileSync(target);
}
function removePriorPackets(context, declared) {
  for (const row of declared.nested) {
    const target = path.join(context.root, sourcePath(row.path));
    try {
      regularBytes(context.root, row.path);
      fs.unlinkSync(target);
    } catch (error) {
      assert.equal(error.code, "ENOENT");
    }
  }
}
function observeNestedPackets(context, directory, declared) {
  const observed = [];
  for (const row of declared.nested) {
    const observation = {
      path: row.path,
      present: false,
      fileStatus: null,
      retained: null,
      error: null,
      qualified: false,
    };
    try {
      const target = path.join(context.root, sourcePath(row.path));
      const stat = fs.lstatSync(target);
      observation.fileStatus = {
        mode: stat.mode & 0o777,
        regular: stat.isFile(),
        symbolicLink: stat.isSymbolicLink(),
        directory: stat.isDirectory(),
      };
      if (stat.isSymbolicLink()) observation.linkTarget = fs.readlinkSync(target);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        const bytes = fs.readFileSync(target);
        const retained = path.join(directory, row.path);
        fs.mkdirSync(path.dirname(retained), { recursive: true });
        fs.writeFileSync(retained, bytes, { mode: 0o644 });
        assert.deepEqual(regularBytes(directory, row.path), bytes);
        observation.present = true;
        observation.retained = { bytes: bytes.length, sha256: joinSHA(bytes) };
      }
    } catch (error) {
      observation.error = { name: error.name, code: error.code ?? null, message: error.message };
    }
    observed.push(observation);
  }
  return observed;
}
function validateRetainedPackets(context, directory, declared, observations) {
  assert.equal(observations.length, declared.nested.length);
  const records = [],
    byPath = new Map();
  for (const row of declared.nested) {
    const observed = observations.find((entry) => entry.path === row.path);
    assert(observed?.present && observed.error === null);
    assert.deepEqual(observed.fileStatus, {
      mode: 0o644,
      regular: true,
      symbolicLink: false,
      directory: false,
    });
    const bytes = regularBytes(directory, row.path);
    assert.equal(bytes.length, observed.retained.bytes);
    assert.equal(joinSHA(bytes), observed.retained.sha256);
    assert.deepEqual(regularBytes(context.root, row.path), bytes);
    const packet = JSON.parse(bytes);
    validateCommonNestedPacket(packet, row);
    const retained = {
      path: row.path,
      ...observed.retained,
      cases: row.cases ?? null,
      ...sourceCredit,
    };
    records.push(retained);
    byPath.set(row.path, { packet, retained });
  }
  for (const row of declared.nested) {
    if (!row.retainedOriginal) continue;
    const actual = byPath.get(row.path).packet.retainedHistoricalLaw;
    const original = byPath.get(row.retainedOriginal);
    assert(actual && original);
    assert.equal(actual.bytes, original.retained.bytes);
    assert.equal(actual.sha256, original.retained.sha256);
    assert.equal(actual.cases, original.retained.cases);
    assert.equal(actual.sourceOnly, true);
    assert.equal(actual.source, original.packet.source);
    assert.equal(actual.packet, path.join(context.root, row.retainedOriginal));
  }
  return records;
}
export async function executeCommonWholeLaw(root, currentHead, context, law, expected) {
  const literal = context.frame.laws.find((row) => row.path === law);
  assert(literal && literal.cases === expected.cases && literal.sha256 === expected.sha256);
  joinIdentity(regularBytes(context.root, law), literal);
  removePriorPackets(context, expected);
  // Match original Node semantics: every inherited key survives except outer test context.
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const argv = ["--test", "--test-reporter=tap", law];
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, argv, {
      cwd: context.root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let error = null,
      bytes = 0;
    const retain = (collection) => (chunk) => {
      bytes += chunk.length;
      collection.push(chunk);
      if (bytes > 16 * 1024 * 1024 && error === null) {
        error = "whole source process output exceeds existing16MiB custody bound";
        child.kill();
      }
    };
    child.stdout.on("data", retain(stdout));
    child.stderr.on("data", retain(stderr));
    child.on("error", (caught) => {
      error = caught.message;
    });
    child.on("close", (status, signal) =>
      resolve({
        status,
        signal,
        error,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
  const directory = path.join(
    root,
    "target/differential/no-dupe-common-source",
    context.frame.source,
    path.basename(law),
  );
  fs.mkdirSync(directory, { recursive: true });
  const packet = {
    currentHead,
    literalSource: context.frame.source,
    literalTree: context.frame.tree,
    originalWholeCallerSHA256: literal.sha256,
    completePhysicalSourceFrameRows: context.frame.files.length,
    historicalCallerCases: literal.cases,
    nodeExecutable: process.execPath,
    nodeVersion: process.version,
    argv,
    ...result,
    stdoutSHA256: joinSHA(result.stdout),
    stderrSHA256: joinSHA(result.stderr),
    forwardedEnvironment: "all inherited keys unchanged except NODE_TEST_CONTEXT",
    removedOuterTestContext: process.env.NODE_TEST_CONTEXT !== undefined,
    nested: [],
    nestedObservations: observeNestedPackets(context, directory, expected),
    validationFailure: null,
    ...sourceCredit,
  };
  const filename = path.join(directory, "whole-law.json");
  fs.writeFileSync(filename, JSON.stringify(packet, null, 2) + "\n");
  try {
    validateCommonProcess(packet, literal.cases);
    packet.nested = validateRetainedPackets(
      context,
      directory,
      expected,
      packet.nestedObservations,
    );
    for (const observed of packet.nestedObservations) observed.qualified = true;
  } catch (error) {
    packet.validationFailure = {
      name: error.name,
      code: error.code ?? null,
      message: error.message,
    };
    fs.writeFileSync(filename, JSON.stringify(packet, null, 2) + "\n");
    throw error;
  }
  fs.writeFileSync(filename, JSON.stringify(packet, null, 2) + "\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(filename)), packet);
  joinIdentity(regularBytes(context.root, law), literal);
  return { ...packet, packet: filename };
}
