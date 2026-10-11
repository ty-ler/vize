import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import type { runOwnerResolveFixture } from "./warm-type-backed-owner-resolve.ts";
import { SessionRoots } from "./warm-type-backed-packets.ts";
import { digest, items, object, readFixture } from "./warm-type-backed-owned-completion-fixture.ts";

type Receipt = Awaited<ReturnType<typeof runOwnerResolveFixture>>;
type Proof = { additional: Array<Record<string, unknown>>; refusalFailures: string[] };
type Issuers = { sourceSHA256: string; rows: Array<Record<string, unknown>> };
const proofs = {
  before: readFixture<Proof>("before-resolve-proof.json"),
  after: readFixture<Proof>("after-resolve-proof.json"),
};
const issuers = {
  before: readFixture<Issuers>("before-resolve-issuers.json"),
  after: readFixture<Issuers>("after-resolve-issuers.json"),
};
const originalFailures = [
  "cross-root/foreign-native-position",
  "cross-root/foreign-authored-owner",
  "native-epoch-recovered/foreign-native-position",
];
assert.equal(proofs.before.refusalFailures.length, 3);
assert.equal(proofs.after.refusalFailures.length, 0);

/** Recover only the bijection already recorded by the original SessionRoots producer. */
function recordedRoots(rows: Array<Record<string, unknown>>) {
  const roots = new SessionRoots();
  const bind = (raw: unknown, comparable: unknown) => {
    if (typeof raw === "string") {
      assert.equal(typeof comparable, "string");
      const spellings = [
        ...raw.matchAll(/\/[^\s"<>]*?\/vize-canon\/editor\/sessions\/session-[^/\s"<>]+\//gu),
      ];
      const tokens = [...(comparable as string).matchAll(/\$EDITOR_SESSION_[1-9][0-9]*\//gu)];
      assert.equal(spellings.length, tokens.length);
      for (const [index, spelling] of spellings.entries()) {
        const previous = roots.spellings.get(spelling[0]);
        assert.ok(previous === undefined || previous === tokens[index][0]);
        roots.spellings.set(spelling[0], tokens[index][0]);
      }
    } else if (Array.isArray(raw)) {
      assert.ok(Array.isArray(comparable));
      assert.equal(raw.length, comparable.length);
      for (const [index, child] of raw.entries()) bind(child, comparable[index]);
    } else if (raw !== null && typeof raw === "object") {
      const normalized = object(comparable);
      assert.deepEqual(Object.keys(raw).toSorted(), Object.keys(normalized).toSorted());
      for (const [key, child] of Object.entries(raw)) bind(child, normalized[key]);
    } else assert.equal(raw, comparable);
  };
  for (const row of rows) bind(row.response, row.comparableResponse);
  for (const row of rows) assert.deepEqual(roots.visit(row.response), row.comparableResponse);
  return roots;
}
const publicIssuers = (rows: Array<Record<string, unknown>>) =>
  rows.map((row) => ({
    stage: row.stage,
    method: row.method,
    params: row.params,
    requestId: row.requestId,
    response: row.response,
    result: row.result,
  }));

/** Preserve the actual three baseline failures and all eight successor positives/refusals. */
export function validateOwnedResolves(
  receipt: Receipt,
  originalSource: unknown,
  side: "before" | "after",
) {
  assert.equal(receipt.failure, undefined);
  assert.deepEqual(receipt.input.source, originalSource);
  assert.equal(digest(JSON.stringify(receipt.input.source)), issuers[side].sourceSHA256);
  assert.equal(receipt.rows.length, 79);
  assert.equal(receipt.additional.length, 16);
  const currentRoots = recordedRoots(receipt.rows);
  const historicalRoots = recordedRoots(issuers[side].rows);
  assert.deepEqual(
    currentRoots.visit(publicIssuers(receipt.rows)),
    historicalRoots.visit(publicIssuers(issuers[side].rows)),
  );
  const failures: string[] = [];
  const requests = new Set<number>();
  for (const [index, row] of receipt.additional.entries()) {
    const expected = proofs[side].additional[index];
    assert.deepEqual(currentRoots.visit(row), historicalRoots.visit(expected));
    assert.ok(typeof row.id === "number" && Number.isSafeInteger(row.id) && !requests.has(row.id));
    requests.add(row.id);
    assert.deepEqual(row.response, { jsonrpc: "2.0", id: row.id, result: row.result });
    const stage = (row.stage as string).split("/")[0];
    const issuedRow = receipt.rows.find(
      (entry) => entry.stage === stage && entry.method === "textDocument/completion",
    );
    assert.ok(issuedRow);
    const issued = items(issuedRow);
    if (!row.refusal) {
      const item = issued.find((entry) => entry.label === (row.stage as string).split("/")[2]);
      assert.ok(item);
      assert.deepEqual(row.params, item);
      const wanted = object(expected.result);
      assert.deepEqual(row.result, {
        ...item,
        detail: wanted.detail,
        documentation: wanted.documentation,
      });
    } else {
      const item = structuredClone(issued[0]);
      const capability = object(object(item.data).vizeCompletion);
      const native = object(object(capability.item).data);
      const suffix = (row.stage as string).split("/")[1];
      if (suffix === "stale-revision") capability.revision = (capability.revision as number) + 1;
      else if (suffix === "foreign-native-file")
        native.fileName = `${String(native.fileName)}.foreign`;
      else if (suffix === "foreign-native-position")
        native.position = (native.position as number) + 1;
      else {
        const previous = receipt.rows
          .slice(0, receipt.rows.indexOf(issuedRow))
          .filter(
            (entry) => entry.method === "textDocument/completion" && Array.isArray(entry.result),
          )
          .at(-1);
        assert.ok(previous);
        const previousItem = items(previous)[0];
        if (suffix === "foreign-authored-owner") {
          const main = object(object(previousItem.data).vizeCompletion);
          capability.uri = main.uri;
          capability.revision = main.revision;
        } else {
          assert.equal(suffix, "retired-process");
          assert.deepEqual(row.params, previousItem);
          assert.deepEqual(row.result, row.params);
          continue;
        }
      }
      assert.deepEqual(row.params, item);
      if (!isDeepStrictEqual(row.result, row.params)) failures.push(row.stage as string);
    }
  }
  const expectedFailures = side === "before" ? originalFailures : [];
  assert.deepEqual(failures, expectedFailures);
  assert.equal(receipt.refusalFailures.length, expectedFailures.length);
  for (const [index, stage] of expectedFailures.entries()) {
    const firstLine = proofs.before.refusalFailures[index].split("\n")[0];
    assert.equal(
      firstLine,
      `AssertionError [ERR_ASSERTION]: ${stage} must retain the whole refused item`,
    );
    assert.equal(receipt.refusalFailures[index].split("\n")[0], firstLine);
  }
}
