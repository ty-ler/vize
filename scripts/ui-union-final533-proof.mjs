import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const publicHead = 'ab77d5c5bcbe033995212f4bb6b51293bfe21e72';
const progressSource = '7aa24063f56de5a674bcfa4a0de315ae9611be02';
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
if (process.argv[2] === 'binding') {
  assert.equal(execFileSync('git', ['diff', '--name-only', publicHead, 'HEAD', '--', 'crates', 'davinci', 'Cargo.toml', 'Cargo.lock'], { encoding: 'utf8' }), '');
  for (const file of ['known-failures.json', 'reference-known-failures.json']) {
    const name = `npm/ui/scripts/vapor-runtime/${file}`;
    assert.deepEqual(execFileSync('git', ['show', `${publicHead}:${name}`]), readFileSync(name));
  }
  const require = createRequire(`${process.cwd()}/npm/ui/package.json`);
  const native = await import(pathToFileURL(require.resolve('@vizejs/native')).href);
  const expected = realpathSync('npm/native/vize-vitrine.linux-x64-gnu.node');
  const loaded = Object.keys(require.cache).filter(x => x.endsWith('.node')).map(x => realpathSync(x));
  assert.ok(loaded.includes(expected));
  assert.equal(typeof native.compileSfc, 'function');
  const binding = { head: head(), publicHead, progressSource, expected, loaded, sha256: digest(readFileSync(expected)) };
  writeFileSync('evidence/binding.json', JSON.stringify(binding, null, 2));
  console.log(JSON.stringify(binding));
} else if (process.argv[2] === 'receipt') {
  const baseline = read('baseline/union-before-after-receipt.json');
  const emitted = read('evidence/current-emitted.json');
  assert.equal(emitted.head, head());
  const oldEmitted = read('baseline/after-emitted.json');
  assert.deepEqual(emitted.inputs, oldEmitted.inputs);
  assert.deepEqual(emitted.results, oldEmitted.results);
  assert.equal(baseline.after, '6a279bc77f531c95abb58ee5b90c634354ef5f3f');
  const result = { publicHead, progressSource, actualSource: head(), binding: read('evidence/binding.json'), lanes: {}, markup: {} };
  const negatives = ['progress-bar-collapsed-negative', 'progress-bar-collapsed-positive', 'progress-bar-wide-endpoint', 'progress-bar-wide-range'];
  for (const track of ['supported', 'reference']) {
    const old = baseline.markup[`after-${track}`].observations;
    const ssr = read(`evidence/${track}/ssr-output.json`);
    assert.equal(ssr.records.length, 533);
    assert.deepEqual(ssr.compileFailures, []);
    assert.ok(ssr.records.every(row => row.error === null));
    assert.deepEqual(ssr.records.map(row => ({ name: row.name, sourceFile: row.sourceFile, html: row.html })), old.map(row => ({ name: row.name, sourceFile: row.sourceFile, html: row.html })));
    const ledger = read(`npm/ui/scripts/vapor-runtime/${track === 'supported' ? 'known-failures' : 'reference-known-failures'}.json`);
    result.lanes[track] = { ssrRendered: 533 };
    for (const lane of ['mount', 'hydrate']) {
      const rows = read(`evidence/${track}/${lane}-output.json`);
      assert.equal(rows.results.length, 533);
      assert.deepEqual(rows.compileFailures, []);
      assert.deepEqual(rows.results, read(`baseline/after-${track}/${lane}-output.json`).results);
      const failed = rows.results.filter(row => row.problems.length > 0);
      const unknown = failed.filter(row => !(row.name in ledger[lane]));
      assert.deepEqual(unknown.map(row => row.name).sort(), track === 'reference' && lane === 'hydrate' ? negatives : []);
      for (const row of unknown) {
        assert.equal(row.problems.length, 1);
        assert.match(row.problems[0], /TypeError: Cannot read properties of undefined \(reading 'nodes'\)/);
        assert.match(row.problems[0], /normalizeBlock[\s\S]+resolveCssVars[\s\S]+styleHasMismatch/);
      }
      const stale = Object.keys(ledger[lane]).filter(name => !failed.some(row => row.name === name));
      assert.deepEqual(stale, []);
      result.lanes[track][lane] = { passed: 533 - failed.length, knownEntries: Object.keys(ledger[lane]).length, unknown: unknown.map(row => row.name), stale };
    }
    const log = readFileSync(`evidence/${track}.log`, 'utf8');
    const summary = log.split('\n').filter(line => line.startsWith('{"check":"@vizejs/ui Vapor runtime conformance"'));
    assert.equal(summary.length, 1);
    assert.equal(JSON.parse(summary[0]).failures, track === 'supported' ? 0 : 4);
  }
  const supportedLog = readFileSync('evidence/supported.log', 'utf8');
  const controlsLines = supportedLog.split('\n').filter(line => line.startsWith('{"check":"whole scoped-union boundaries"'));
  assert.equal(controlsLines.length, 1);
  const controls = JSON.parse(controlsLines[0]);
  const controlFixture = read('tests/_fixtures/differential/compiler/scoped-union-props/controls.json');
  assert.deepEqual(controls.inputs, controlFixture);
  assert.deepEqual(controls.official, controlFixture.official);
  assert.equal(controls.native.length, 18);
  for (const observation of controls.native) {
    assert.deepEqual(observation.result.errors, []);
    assert.equal(typeof observation.result.code, 'string');
    assert.ok(observation.result.code.length > 0);
  }
  writeFileSync('evidence/whole-union-boundaries.json', JSON.stringify({ actualSource: head(), binding: result.binding, ...controls }, null, 2));
  result.unionBoundaryControls = { nativeWholeResults: 18, officialWholeResults: 30, officialRefusals: controls.official.filter(row => row.error !== undefined).length, inheritedNativeRefusalAndForeignAliasGaps: true };
  const { installDomGlobals } = await import(pathToFileURL(`${process.cwd()}/npm/ui/scripts/vapor-runtime/dom-env.ts`).href);
  installDomGlobals();
  const { registerSfcHooks } = await import(pathToFileURL(`${process.cwd()}/npm/ui/scripts/vapor-runtime/sfc-hooks.ts`).href);
  registerSfcHooks('ssr');
  const { loadRuntimeFixtures } = await import(pathToFileURL(`${process.cwd()}/npm/ui/scripts/vapor-runtime/fixtures.ts`).href);
  const fixtures = await loadRuntimeFixtures();
  assert.equal(fixtures.length, 533);
  for (const track of ['supported', 'reference']) {
    const rows = read(`evidence/${track}/ssr-output.json`).records;
    const observations = rows.map((row, index) => {
      const fixture = fixtures[index];
      assert.equal(fixture.name, row.name);
      let error = null;
      try { fixture.assertServerMarkup(row.html); } catch (cause) { error = cause.stack ?? String(cause); }
      return { ...row, assertion: fixture.assertServerMarkup.toString(), error };
    });
    const failures = observations.filter(row => row.error !== null).map(row => row.name).sort();
    assert.deepEqual(failures, baseline.markup[`after-${track}`].failures);
    result.markup[track] = { passed: 533 - failures.length, failures, observations };
  }
  writeFileSync('evidence/final533-receipt.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, markup: Object.fromEntries(Object.entries(result.markup).map(([k,v]) => [k, { passed: v.passed, failures: v.failures }])) }));
} else throw new Error('Unknown command');
