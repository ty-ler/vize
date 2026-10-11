import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd();
const read = file => JSON.parse(readFileSync(`${root}/${file}`, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const before = '2eed646c3293d83bf14d005c02b068e81909867f';
const after = '6a279bc77f531c95abb58ee5b90c634354ef5f3f';
const command = process.argv[2];

if (command === 'binding') {
  const require = createRequire(`${root}/npm/ui/package.json`);
  const native = await import(pathToFileURL(require.resolve('@vizejs/native')).href);
  const expected = realpathSync(`${root}/npm/native/vize-vitrine.linux-x64-gnu.node`);
  const loaded = Object.keys(require.cache).filter(name => name.endsWith('.node')).map(name => realpathSync(name));
  assert.ok(loaded.includes(expected));
  assert.equal(typeof native.compileSfc, 'function');
  const receipt = { head: head(), expected, loaded, sha256: digest(readFileSync(expected)) };
  writeFileSync(`evidence/${process.argv[3]}-binding.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} else if (command === 'emitted') {
  const require = createRequire(`${root}/npm/ui/package.json`);
  const native = await import(pathToFileURL(require.resolve('@vizejs/native')).href);
  const expected = realpathSync(`${root}/npm/native/vize-vitrine.linux-x64-gnu.node`);
  assert.ok(Object.keys(require.cache).some(name => name.endsWith('.node') && realpathSync(name) === expected));
  const packetRoot = `${root}/tests/_fixtures/differential/compiler/scoped-union-props`;
  const packet = JSON.parse(readFileSync(`${packetRoot}/fixture.json`, 'utf8'));
  const inputRoot = `${root}/evidence/union-inputs`;
  mkdirSync(inputRoot, { recursive: true });
  const inputs = {};
  for (const { path: name, sha256 } of packet.inputs) {
    const source = readFileSync(`${packetRoot}/${name}`, 'utf8');
    assert.equal(digest(source), sha256);
    inputs[name] = { source, sha256 };
    writeFileSync(`${inputRoot}/${name.replace(/\.txt$/, '')}`, source);
  }
  const results = [];
  for (const name of ['Inline', 'Imported', 'Plain']) {
    for (const lane of ['ssr', 'dom', 'vapor']) {
      const source = inputs[`${name}.vue.txt`].source;
      const result = native.compileSfc(source, { filename: path.join(inputRoot, `${name}.vue`), mode: 'module', isTs: true, ssr: lane === 'ssr', vapor: lane === 'vapor' });
      assert.deepEqual(result.errors, []);
      results.push({ name, lane, sourceSha256: digest(source), moduleSha256: digest(result.code), result });
    }
  }
  writeFileSync(`evidence/${process.argv[3]}-emitted.json`, JSON.stringify({ head: head(), inputs, results }, null, 2));
} else if (command === 'golden-negative') {
  assert.equal(head(), before);
  const log = readFileSync('evidence/before-golden.log', 'utf8');
  assert.match(log, /ERR_ASSERTION/);
  assert.match(log, /Inline\/vue\/native\/initial/);
  assert.doesNotMatch(log, /MODULE_NOT_FOUND|Cannot find module|SyntaxError/);
  console.log('The unmodified whole golden test fails at native inline SSR before the source fix.');
} else if (command === 'receipt') {
  assert.equal(head(), after);
  assert.equal(execFileSync('git', ['diff', '--name-only', before, after, '--', 'npm/ui/src'], { encoding: 'utf8' }), '');
  for (const name of ['reference-known-failures.json', 'known-failures.json']) {
    const file = `npm/ui/scripts/vapor-runtime/${name}`;
    assert.deepEqual(execFileSync('git', ['show', `${before}:${file}`]), readFileSync(file));
  }
  const beforeBinding = read('evidence/before-binding.json');
  const afterBinding = read('evidence/after-binding.json');
  assert.equal(beforeBinding.head, before);
  assert.equal(afterBinding.head, after);
  assert.notEqual(beforeBinding.sha256, afterBinding.sha256);
  const beforeEmitted = read('evidence/before-emitted.json');
  const afterEmitted = read('evidence/after-emitted.json');
  assert.equal(beforeEmitted.head, before);
  assert.equal(afterEmitted.head, after);
  assert.deepEqual(beforeEmitted.inputs, afterEmitted.inputs);
  assert.equal(beforeEmitted.results.length, 9);
  assert.equal(afterEmitted.results.length, 9);
  for (let index = 0; index < 9; index++) {
    const old = beforeEmitted.results[index];
    const current = afterEmitted.results[index];
    assert.equal(old.name, current.name);
    assert.equal(old.lane, current.lane);
    assert.equal(old.sourceSha256, current.sourceSha256);
    if (old.name === 'Plain') assert.deepEqual(old.result, current.result);
    else assert.notEqual(old.moduleSha256, current.moduleSha256);
  }
  const targetNames = ['icon', 'icon-button'];
  const progressNames = ['progress-bar-collapsed-negative', 'progress-bar-collapsed-positive', 'progress-bar-wide-endpoint', 'progress-bar-wide-range'];
  const ledgers = {
    reference: read('npm/ui/scripts/vapor-runtime/reference-known-failures.json'),
    supported: read('npm/ui/scripts/vapor-runtime/known-failures.json'),
  };
  const summaries = {};
  const raw = {};
  let expectedOrder;
  for (const phase of ['before', 'after']) {
    summaries[phase] = {};
    for (const track of ['supported', 'reference']) {
      const prefix = `evidence/${phase}-${track}`;
      const ssr = read(`${prefix}/ssr-output.json`);
      assert.equal(ssr.records.length, 533);
      assert.deepEqual(ssr.compileFailures, []);
      assert.ok(ssr.records.every(row => row.error === null && typeof row.html === 'string'));
      const order = ssr.records.map(({ name, sourceFile }) => ({ name, sourceFile }));
      expectedOrder ??= order;
      assert.deepEqual(order, expectedOrder);
      raw[`${phase}-${track}`] = ssr;
      summaries[phase][track] = { ssrRendered: 533 };
      let totalFailures = 0;
      for (const lane of ['mount', 'hydrate']) {
        const result = read(`${prefix}/${lane}-output.json`);
        assert.equal(result.results.length, 533);
        assert.deepEqual(result.compileFailures, []);
        assert.deepEqual(result.results.map(({ name }) => name), order.map(({ name }) => name));
        const known = ledgers[track][lane];
        const failed = result.results.filter(({ problems }) => problems.length > 0);
        const failedNames = new Set(failed.map(({ name }) => name));
        const unknown = failed.filter(({ name }) => !(name in known));
        const expectedUnknown = track === 'reference' && lane === 'hydrate' ? progressNames : [];
        assert.deepEqual(unknown.map(({ name }) => name).sort(), expectedUnknown);
        for (const row of unknown) {
          assert.equal(row.problems.length, 1);
          assert.match(row.problems[0], /TypeError: Cannot read properties of undefined \(reading 'nodes'\)/);
          assert.match(row.problems[0], /normalizeBlock[\s\S]+resolveCssVars[\s\S]+styleHasMismatch/);
        }
        const stale = Object.keys(known).filter(name => !failedNames.has(name)).sort();
        assert.deepEqual(stale, phase === 'before' ? [] : targetNames);
        for (const name of targetNames) {
          const rows = result.results.filter(row => row.name === name);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].problems.length === 0, phase === 'after');
        }
        for (const name of progressNames) {
          if (track === 'supported') assert.deepEqual(result.results.filter(row => row.name === name), [{ name, problems: [] }]);
          assert.equal(name in known, false);
        }
        totalFailures += unknown.length + stale.length;
        summaries[phase][track][lane] = { passed: 533 - failed.length, failedRows: failed.length, knownEntries: Object.keys(known).length, stale, unknown: unknown.map(row => row.name) };
      }
      const log = readFileSync(`evidence/${phase}-${track}.log`, 'utf8');
      const lines = log.split('\n').filter(line => line.startsWith('{"check":"@vizejs/ui Vapor runtime conformance"'));
      assert.equal(lines.length, 1);
      const summary = JSON.parse(lines[0]);
      assert.equal(summary.fixtures, 533);
      assert.equal(summary.runtime, track);
      assert.equal(summary.failures, totalFailures);
    }
  }
  const { installDomGlobals } = await import(pathToFileURL(`${root}/npm/ui/scripts/vapor-runtime/dom-env.ts`).href);
  installDomGlobals();
  const { registerSfcHooks } = await import(pathToFileURL(`${root}/npm/ui/scripts/vapor-runtime/sfc-hooks.ts`).href);
  registerSfcHooks('ssr');
  const { loadRuntimeFixtures } = await import(pathToFileURL(`${root}/npm/ui/scripts/vapor-runtime/fixtures.ts`).href);
  const fixtures = await loadRuntimeFixtures();
  assert.equal(fixtures.length, 533);
  const markup = {};
  const failuresByTrack = {
    reference: ['icon', 'icon-button', 'signature-pad-canvas'],
    supported: ['icon', 'icon-button', 'media-player-time-display', 'scrubber-preview-time', 'signature-pad-canvas', 'webcam-capture-shutter', 'webcam-capture-start-button'],
  };
  for (const phase of ['before', 'after']) {
    for (const track of ['supported', 'reference']) {
      const records = raw[`${phase}-${track}`].records;
      const observations = [];
      for (let index = 0; index < fixtures.length; index++) {
        const fixture = fixtures[index];
        const record = records[index];
        assert.equal(record.name, fixture.name);
        let error = null;
        try { fixture.assertServerMarkup(record.html); } catch (cause) { error = cause.stack ?? String(cause); }
        observations.push({ ...record, assertion: fixture.assertServerMarkup.toString(), error });
      }
      const names = observations.filter(row => row.error !== null).map(row => row.name).sort();
      const expected = failuresByTrack[track].filter(name => phase === 'before' || !targetNames.includes(name)).sort();
      assert.deepEqual(names, expected);
      markup[`${phase}-${track}`] = { passed: 533 - names.length, failures: names, observations };
    }
  }
  const receipt = { check: 'exact native union before/after complete 533 and whole original SSR markup assertions', before, after, beforeBinding, afterBinding, summaries, markup };
  writeFileSync('evidence/union-before-after-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ...receipt, markup: Object.fromEntries(Object.entries(markup).map(([key, value]) => [key, { passed: value.passed, failures: value.failures }])) }));
} else {
  throw new Error(`Unknown proof command ${command}`);
}
