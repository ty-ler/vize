// Private before/after receipt. The reference process and its ledger stay
// unchanged: its nonzero exit must be precisely the four original regressions.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const referenceFile = 'npm/ui/scripts/vapor-runtime/reference-known-failures.json';
const referenceBytes = readFileSync(referenceFile);
const originalBytes = execFileSync('git', [
  'show', 'db6e7805e5c26aafe8ae1614bc77668cd3459d1d:npm/ui/scripts/vapor-runtime/known-failures.json',
]);
assert.deepEqual(referenceBytes, originalBytes);
const ledgers = {
  reference: read(referenceFile),
  supported: read('npm/ui/scripts/vapor-runtime/known-failures.json'),
};
const targets = [
  'progress-bar-collapsed-negative', 'progress-bar-collapsed-positive',
  'progress-bar-wide-endpoint', 'progress-bar-wide-range',
];
const summaries = {};
const sourceNames = {};
const observations = [];
for (const track of ['supported', 'reference']) {
  const prefix = `evidence/${track}`;
  const ssr = read(`${prefix}/ssr-output.json`);
  assert.equal(ssr.records.length, 533);
  assert.deepEqual(ssr.compileFailures, []);
  assert.ok(ssr.records.every((row) => row.error === null && typeof row.html === 'string'));
  sourceNames[track] = ssr.records.map(({ name, sourceFile }) => ({ name, sourceFile }));
  summaries[track] = { ssr: { passed: 533, failed: 0 } };
  for (const lane of ['mount', 'hydrate']) {
    const result = read(`${prefix}/${lane}-output.json`);
    assert.equal(result.results.length, 533);
    assert.deepEqual(result.compileFailures, []);
    assert.deepEqual(result.results.map(({ name }) => name), ssr.records.map(({ name }) => name));
    const known = ledgers[track][lane];
    const failed = result.results.filter(({ problems }) => problems.length > 0);
    const failedNames = [...new Set(failed.map(({ name }) => name))].sort();
    const unknown = failed.filter(({ name }) => !(name in known));
    const expectedNew = track === 'reference' && lane === 'hydrate' ? targets : [];
    assert.deepEqual(unknown.map(({ name }) => name).sort(), expectedNew);
    assert.deepEqual(failedNames.filter((name) => name in known), Object.keys(known).sort());
    for (const record of unknown) {
      assert.equal(record.problems.length, 1);
      assert.match(record.problems[0], /TypeError: Cannot read properties of undefined \(reading 'nodes'\)/);
      assert.match(record.problems[0], /normalizeBlock[\s\S]+resolveCssVars[\s\S]+styleHasMismatch/);
      observations.push({ track, lane, ...record });
    }
    summaries[track][lane] = {
      passed: 533 - failed.length,
      failedRows: failed.length,
      knownEntries: Object.keys(known).length,
      newFailures: unknown.map(({ name }) => name),
    };
    for (const name of targets) {
      if (track === 'supported') {
        assert.deepEqual(result.results.filter((row) => row.name === name), [{ name, problems: [] }]);
        assert.equal(name in known, false);
      }
    }
  }
  const log = readFileSync(`evidence/ui-${track}.log`, 'utf8');
  const rows = log.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const summary = rows.filter((row) => row.check === '@vizejs/ui Vapor runtime conformance');
  assert.equal(summary.length, 1);
  assert.equal(summary[0].runtime, track);
  assert.equal(summary[0].fixtures, 533);
  assert.equal(summary[0].failures, track === 'supported' ? 0 : 4);
}
assert.deepEqual(sourceNames.supported, sourceNames.reference);
const receipt = {
  check: 'full original 533 supported success and immutable rc9 negative oracle',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  referenceLedgerSha256: createHash('sha256').update(referenceBytes).digest('hex'),
  summaries, observations,
};
writeFileSync('evidence/before-after-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, observations: observations.map(({ track, lane, name }) => ({ track, lane, name })) }));
