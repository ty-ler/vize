import assert from "node:assert/strict";

// strace v6.8 util.c:string_quote, HEXSTR_NON_ASCII_CHARS. Every byte remains observable.
// https://github.com/strace/strace/blob/v6.8/src/util.c#L996
export function kernelStringBytes(encoded: string) {
  const bytes: number[] = [];
  const symbolic: Record<string, number> = {
    '"': 34,
    "\\": 92,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
  };
  for (let offset = 0; offset < encoded.length; offset++) {
    const code = encoded.charCodeAt(offset);
    if (code !== 92) {
      assert.ok(code >= 32 && code <= 126 && code !== 34, "unescaped bytes cannot qualify");
      bytes.push(code);
      continue;
    }
    const escape = encoded[++offset];
    if (escape === "x") {
      const hex = encoded.slice(offset + 1, offset + 3);
      assert.match(hex, /^[0-9a-f]{2}$/u, "partial hexadecimal bytes cannot qualify");
      bytes.push(Number.parseInt(hex, 16));
      offset += 2;
    } else {
      assert.ok(Object.hasOwn(symbolic, escape), "unknown kernel escapes cannot qualify");
      bytes.push(symbolic[escape]);
    }
  }
  return Buffer.from(bytes);
}
