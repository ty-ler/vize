import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const directory = '/tmp/vize-attrs-expression-ranges-20261012';
const corpusPath = path.join(directory, 'authored-corpus-with-root-scopes.json');
const corpusBytes = fs.readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(corpusBytes), '143fde86fb0e2bf7554829fe8ad6a2b3432a631ee0f7aecd0f1fdb58bf4d318c');
const binary = '/var/folders/8k/gm2q62k57yb9h1kmw2kf2tzm0000gn/T/vize-lint-prefilter-public-n57i19hn/vize';
const binarySha = '9ad7cf956351265a152a9bbfa08b8c50c85dadacef66529474bbb6170267e254';
assert.equal(sha(fs.readFileSync(binary)), binarySha);
const primaryPath = '/tmp/vize-no-export-preset-provider18-20261012/authored-provider18.json';
const primaryBytes = fs.readFileSync(primaryPath);
const primary = JSON.parse(primaryBytes);
for (const p of primary.provider.packages) {
  assert.equal(sha(fs.readFileSync(path.join(p.packageRoot, 'package.json'))), p.packageJsonSha256);
  for (const f of p.files) {
    const b = fs.readFileSync(path.join(p.packageRoot, f.path));
    assert.equal(b.length, f.bytes);
    assert.equal(sha(b), f.sha256, `${p.name}/${f.path}`);
  }
}
const require = createRequire(path.join(primary.provider.root, 'package.json'));
const { ESLint } = require('eslint');
const pluginModule = require('eslint-plugin-vue');
const plugin = pluginModule.rules ? pluginModule : pluginModule.default;
const vueParser = require('vue-eslint-parser');
const tsParser = require('@typescript-eslint/parser');
const providerConfig = {
  files: ['**/*.vue'], languageOptions: {
    parser: vueParser, parserOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module',
      ecmaFeatures: { jsx: true }, extraFileExtensions: ['.vue'] },
  }, linterOptions: { reportUnusedDisableDirectives: 'off' }, plugins: { vue: plugin },
  rules: { 'vue/no-duplicate-attr-inheritance': 'warn' },
};
// Exact original Matrix config shape, scoped to this rule. It is a separate
// role from the immutable all-rule Matrix packet; no full parity is claimed.
const eslint = new ESLint({ cwd: directory, passOnNoPatterns: false,
  overrideConfigFile: true, overrideConfig: [providerConfig], errorOnUnmatchedPattern: false });
const controls = path.join(directory, 'controls');
fs.mkdirSync(controls, { recursive: true });
const output = path.join(directory, 'whole-before-and-official.json');
const evidence = { schema: 'vize.lint.attrs-expression-ranges-before-reference', version: 1,
  authority: 'Public443 unchanged producer and pinned official scoped role only. No candidate/native/API/source/whole Matrix/public-after qualification. Original authored vectors and first failures remain immutable.',
  corpus: { path: corpusPath, sha256: sha(corpusBytes), bytes: corpusBytes.length },
  observerSha256: sha(fs.readFileSync('/tmp/vize-attrs-expression-ranges-20261012/observe-before.mjs')),
  binary: { path: binary, sha256: binarySha,
    publicTuple: { C: '123c0f363d90bfa20cbf669f52ddb85343332568', H: '15e116fa258c7aaba5c6fdd2456442535605abe8', R: '38081199501' } },
  provider: { primaryPath, primarySha256: sha(primaryBytes), packages: primary.provider.packages,
    config: { files: ['**/*.vue'], parser: 'vue-eslint-parser@10.4.1', scriptParser: '@typescript-eslint/parser@8.65.0',
      ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, extraFileExtensions: ['.vue'],
      linterOptions: { reportUnusedDisableDirectives: 'off' }, rules: { 'vue/no-duplicate-attr-inheritance': 'warn' },
      overrideConfigFile: true, errorOnUnmatchedPattern: false, passOnNoPatterns: false } },
  cases: [], complete: false };
const persist = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
persist();
for (const c of corpus.cases) {
  assert.equal(sha(c.source), c.sourceSha256);
  const filename = path.join(controls, c.filename);
  fs.writeFileSync(filename, c.source);
  const config = JSON.stringify(c.config, null, 2) + '\n';
  fs.writeFileSync(path.join(controls, 'vize.config.json'), config);
  const argv = ['lint', '--config', 'vize.config.json', '--format', 'json', '--locale', 'en', '--help-level', 'none', c.filename];
  const native = spawnSync(binary, argv, { cwd: controls, encoding: null, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const row = { id: c.id, filename: c.filename, source: c.source, sourceSha256: c.sourceSha256,
    config, configSha256: sha(config), beforeExpected: c.beforeCli, beforeExpectedStatus: c.beforeStatus,
    native: { argv, cwd: controls, status: native.status, signal: native.signal,
      error: native.error ? { name: native.error.name, message: native.error.message, stack: native.error.stack } : null,
      stdoutBase64: (native.stdout ?? Buffer.alloc(0)).toString('base64'), stderrBase64: (native.stderr ?? Buffer.alloc(0)).toString('base64') },
    finalSource: fs.readFileSync(filename).toString('utf8'), officialExpected: c.officialExpected };
  evidence.cases.push(row);
  try { row.native.wholeJson = JSON.parse((native.stdout ?? Buffer.alloc(0)).toString('utf8')); }
  catch (error) { row.native.parseError = { name: error.name, message: error.message, stack: error.stack }; }
  persist();
  try { assert.deepEqual(row.native.wholeJson, c.beforeCli); assert.equal(native.status, c.beforeStatus); assert.equal(row.finalSource, c.source); row.native.expectedMatch = true; }
  catch (error) { row.native.expectedMatch = false; row.native.expectedFailure = { name: error.name, message: error.message, stack: error.stack }; }
  // Genuine lintFiles reproduces the pinned original API choice; whole output
  // remains unprojected, including any parse/suppressed/deprecated fields.
  try { row.officialWholeResult = await eslint.lintFiles([filename]); }
  catch (error) { row.officialError = { name: error.name, message: error.message, stack: error.stack }; }
  persist();
  try { assert.deepEqual(row.officialWholeResult, c.officialExpected); row.officialExpectedMatch = true; }
  catch (error) { row.officialExpectedMatch = false; row.officialExpectedFailure = { name: error.name, message: error.message, stack: error.stack }; }
  persist();
}
assert.equal(sha(fs.readFileSync(binary)), binarySha);
assert.equal(sha(fs.readFileSync(corpusPath)), evidence.corpus.sha256);
evidence.complete = true;
persist();
console.log(JSON.stringify({ output, sha256: sha(fs.readFileSync(output)), bytes: fs.statSync(output).size,
  nativePass: evidence.cases.filter(c => c.native.expectedMatch).length,
  officialPass: evidence.cases.filter(c => c.officialExpectedMatch).length,
  failures: evidence.cases.filter(c => !c.native.expectedMatch || !c.officialExpectedMatch).map(c => ({ id: c.id, native: c.native.expectedMatch, official: c.officialExpectedMatch })) }, null, 2));
