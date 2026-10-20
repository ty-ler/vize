import assert from "node:assert/strict";

import { rewriteStaticAssetUrls } from "./transform.ts";

const output = rewriteStaticAssetUrls(
  'const nodes = [{ src: "./assets/logo.png" }, { src: "#assets/logo.png" }, { src: "#icon" }];',
  [],
);

assert.match(output, /import __vize_static_0 from "\.\/assets\/logo\.png";/);
assert.match(output, /import __vize_static_1 from "#assets\/logo\.png";/);
assert.match(output, /src: "#icon"/);
