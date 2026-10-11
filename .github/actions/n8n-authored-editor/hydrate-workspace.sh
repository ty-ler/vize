mkdir -p "$receipt"
git -C "$fixture" rev-parse HEAD > "$receipt/n8n-source-sha.txt"
git -C "$fixture" diff --exit-code
sha256sum "$fixture/package.json" "$fixture/pnpm-lock.yaml" \
  "$fixture/pnpm-workspace.yaml" \
  "$fixture/packages/frontend/editor-ui/tsconfig.json" \
  "$fixture/packages/@n8n/typescript-config/package.json" \
  > "$receipt/original-inputs.sha256"
npm install --prefix "$bootstrap" --ignore-scripts --no-audit --no-fund pnpm@12.4.2
sha256sum "$bootstrap/node_modules/pnpm/package.json" \
  "$bootstrap/node_modules/pnpm/bin/pnpm.mjs" \
  "$bootstrap/node_modules/@pnpm/exe.linux-x64/package.json" \
  "$bootstrap/node_modules/@pnpm/exe.linux-x64/pnpm" > "$receipt/pnpm-producer.sha256"
(
  cd "$fixture"
  node "$bootstrap/node_modules/pnpm/bin/pnpm.mjs" --version \
    | tee "$receipt/pnpm-version.txt"
  test "$(cat "$receipt/pnpm-version.txt")" = 12.4.2
  node "$bootstrap/node_modules/pnpm/bin/pnpm.mjs" install \
    --frozen-lockfile --ignore-scripts --filter 'n8n-editor-ui...' \
    --reporter append-only
) 2>&1 | tee "$receipt/install.log"
sha256sum --check "$receipt/original-inputs.sha256"
git -C "$fixture" diff --exit-code
vp node --input-type=module - "$fixture" "$receipt" <<'NODE'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const [fixture, receipt] = process.argv.slice(2);
const original = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'));
assert.equal(original.packageManager, 'pnpm@12.4.2');
const require = createRequire(path.join(fixture, 'packages/frontend/editor-ui/package.json'));
const selected = fs.realpathSync(require.resolve('@n8n/typescript-config/tsconfig.frontend.json'));
const authored = fs.realpathSync(path.join(fixture, 'packages/@n8n/typescript-config/tsconfig.frontend.json'));
assert.deepEqual(fs.readFileSync(selected), fs.readFileSync(authored), 'the selected config must preserve the original pinned workspace bytes');
const installedManifest = require.resolve('@n8n/typescript-config/package.json');
assert.deepEqual(fs.readFileSync(installedManifest), fs.readFileSync(path.join(fixture, 'packages/@n8n/typescript-config/package.json')));
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(selected)).digest('hex');
fs.writeFileSync(path.join(receipt, 'selected-config.json'), `${JSON.stringify({ packageManager: original.packageManager, selected, authored, sha256 }, null, 2)}\n`);
NODE
