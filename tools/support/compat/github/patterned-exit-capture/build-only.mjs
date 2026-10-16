import assert from "node:assert/strict";
import { readFileSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Use the literal historical loadRuntime: same build flags, one-chunk assert,
// and data-module import. Importing this module does not arm the exit workaround.
const { loadRuntime } = await import(pathToFileURL(process.argv[2]));
const input = JSON.parse(readFileSync(0, "utf8"));
assert.equal(input.backend, "vapor");
assert.equal(input.cases.length, 1);
await loadRuntime({ production: false });
// This is a build-only observation, never a passing DOM fixture result.
writeSync(1, '{"built":1}');
