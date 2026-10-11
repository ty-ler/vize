import assert from "node:assert/strict";

export type Packet = Record<string, unknown>;
export function packet(value: unknown): Packet {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected complete object packet",
  );
  return value as Packet;
}
export function list(value: unknown): unknown[] {
  assert(Array.isArray(value), "Expected complete array packet");
  return value;
}
export function text(value: unknown): string {
  assert.equal(typeof value, "string", "Expected string authority");
  return value as string;
}
export function number(value: unknown): number {
  assert(
    typeof value === "number" && Number.isFinite(value) && value >= 0,
    "Expected finite nonnegative measurement",
  );
  return value;
}
const urlFields = new Set(["url", "href", "hrefs", "links", "src", "nativeTarget"]);

/** Only an owned server origin changes; full query/hash and external targets remain exact. */
export function normalizeWorkersPacket(value: unknown, origin: string, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeWorkersPacket(item, origin, key));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(packet(value)).map(([field, item]) => [
        field,
        normalizeWorkersPacket(item, origin, field),
      ]),
    );
  if (typeof value === "string" && urlFields.has(key) && value.startsWith(`${origin}/`)) {
    const url = new URL(value);
    return `http://owned-loopback.invalid${url.pathname}${url.search}${url.hash}`;
  }
  return value;
}
