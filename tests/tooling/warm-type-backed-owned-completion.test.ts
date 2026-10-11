import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareOwnedCompletionPackets } from "../performance/support/warm-type-backed-owned-completion-successor.ts";
import {
  completePackets,
  digest,
  fixtureRoot,
  object,
  originalPackets,
  readFixture,
} from "../performance/support/warm-type-backed-owned-completion-fixture.ts";
import {
  ownedCompletionManifest,
  qualifyOwnedCompletionHost,
} from "../performance/support/warm-type-backed-owned-completion-host.ts";

import { control } from "./support/warm-type-backed-owned-completion-control.ts";

function compare({ pair, resolved }: ReturnType<typeof control>) {
  compareOwnedCompletionPackets(
    completePackets(pair.before),
    completePackets(pair.after),
    pair,
    resolved,
  );
}

await test("the original whole79 comparison is RED; the exact two native-owned responses qualify without rewriting", () => {
  const value = control();
  assert.throws(() =>
    assert.deepEqual(completePackets(value.pair.after), completePackets(value.pair.before)),
  );
  const before = structuredClone(value.pair);
  compare(value);
  assert.deepEqual(value.pair, before);
});

await test("every one of the other77 complete response envelopes remains mandatory", () => {
  for (const row of originalPackets.filter((entry) => ![72, 80].includes(entry.requestId))) {
    const value = control();
    const actual = value.pair.after.rows.find((entry) => entry.requestId === row.requestId)!;
    actual.comparableResponse = { ...object(actual.comparableResponse), surplus: true };
    assert.throws(() => compare(value), `${row.stage}/${row.method}`);
  }
  compare(control());
});

await test("all20 approved capability fields remain literal full-response expectations", () => {
  for (const id of [72, 80])
    for (const item of [0, 1, 2, 3])
      for (const field of id === 72
        ? ["fileName", "position", "requestUri"]
        : ["fileName", "requestUri"]) {
        const value = control();
        const row = value.pair.after.rows.find((entry) => entry.requestId === id)!;
        const capability = object(
          object(object((object(row.comparableResponse).result as unknown[])[item]).data)
            .vizeCompletion,
        );
        const target = field === "requestUri" ? capability : object(object(capability.item).data);
        target[field] =
          typeof target[field] === "number"
            ? (target[field] as number) + 1
            : `${String(target[field])}.foreign`;
        assert.throws(() => compare(value), `${id}/${item}/${field}`);
      }
  compare(control());
});

await test("missing or changed native bodies, startup owners, epochs and any of the16 complete outcomes refuse", () => {
  for (const mutate of [
    (v: ReturnType<typeof control>) => {
      v.pair.after.rows.find((row) => row.requestId === 72)!.ownerMigration = null;
    },
    (v: ReturnType<typeof control>) => {
      const owner = object(v.pair.after.rows.find((row) => row.requestId === 72)!.ownerMigration);
      object((owner.files as unknown[])[0]).code += "\n";
    },
    (v: ReturnType<typeof control>) => {
      object(v.pair.after.rows.find((row) => row.requestId === 72)!.ownerMigration).startup = [];
    },
    (v: ReturnType<typeof control>) => {
      v.pair.after.changedInputs = [];
    },
  ]) {
    const value = control();
    mutate(value);
    assert.throws(() => compare(value));
  }
  for (let i = 0; i < 16; i++) {
    const value = control();
    value.resolved[1].additional.splice(i, 1);
    assert.throws(() => compare(value));
    const changed = control();
    object(changed.resolved[1].additional[i].result).detail = "foreign";
    assert.throws(() => compare(changed));
  }
  compare(control());
});

await test("both actual baseline receipts and all three original refusal failures are mandatory", () => {
  for (let i = 0; i < 16; i++) {
    const missing = control();
    missing.resolved[0].additional.splice(i, 1);
    assert.throws(() => compare(missing));
    const changed = control();
    object(changed.resolved[0].additional[i].result).surplus = true;
    assert.throws(() => compare(changed));
  }
  for (let i = 0; i < 3; i++) {
    const value = control();
    value.resolved[0].refusalFailures.splice(i, 1);
    assert.throws(() => compare(value));
  }
  for (const side of [0, 1]) {
    const value = control();
    value.resolved[side].rows[0].params = { foreign: true };
    assert.throws(() => compare(value));
    const changedSource = control();
    changedSource.resolved[side].input.source["src/c/Comp0.vue"] += "\n";
    assert.throws(() => compare(changedSource));
  }
  compare(control());
});

await test("a foreign project root, attachment pipe or native epoch cannot qualify", () => {
  for (const mutate of [
    (owner: Record<string, unknown>) => {
      owner.root += ".foreign";
    },
    (owner: Record<string, unknown>) => {
      owner.virtualFile = `${String(owner.root)}/foreign.vue.ts`;
    },
    (owner: Record<string, unknown>) => {
      object(object((owner.startup as unknown[])[0]).apiAttachment).pipe += ".foreign";
    },
    (owner: Record<string, unknown>) => {
      object(object((owner.sockets as unknown[])[0]).process).birth_ticks = -1;
    },
    (owner: Record<string, unknown>) => {
      object(object((owner.startup as unknown[])[0]).nativeConfig).fileNames = [];
    },
  ]) {
    const value = control();
    mutate(object(value.pair.after.rows.find((row) => row.requestId === 72)!.ownerMigration));
    assert.throws(() => compare(value));
  }
  const reused = control();
  const cross = object(reused.pair.after.rows.find((row) => row.requestId === 72)!.ownerMigration);
  object(reused.pair.after.rows.find((row) => row.requestId === 80)!.ownerMigration).sockets =
    structuredClone(cross.sockets);
  assert.throws(() => compare(reused));
  compare(control());
});

await test("the complete historical helper body and original3 native refusal failures stay archival", () => {
  const historical = fs.readFileSync(
    new URL("historical-owner-migration.ts.txt", fixtureRoot),
    "utf8",
  );
  const current = fs.readFileSync(
    new URL("../performance/support/warm-type-backed-owner-migration.ts", import.meta.url),
    "utf8",
  );
  assert.ok(current.includes(historical.slice(historical.indexOf("/** Retain"))));
  const requests = fs.readFileSync(new URL("historical-requests.ts.txt", fixtureRoot), "utf8");
  const actualRequests = fs.readFileSync(
    new URL("../performance/support/warm-type-backed-requests.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    actualRequests,
    requests
      .replace("import { completeOwnerPackets }", "import { compareOwnerPackets }")
      .replace(
        "  const completePackets = await completeOwnerPackets(publicPackets, packet);\n  assert.deepEqual(completePackets(after), completePackets(before));",
        "  await compareOwnerPackets(publicPackets(before), publicPackets(after), packet);",
      ),
  );
  const old = readFixture<{ refusalFailures: string[] }>("before-resolve-proof.json");
  assert.equal(old.refusalFailures.length, 3);
  assert.throws(() => {
    object(originalPackets[0].response).surplus = true;
  });
  compare(control());
});

await test("actual source identities bind the qualified driver while archived source identities stay literal", () => {
  const fresh = control();
  fresh.pair.sourceBinding.baseline = fresh.pair.before.source.revision =
    "364bdae86e4215f4f161afcbe260d9c213709275";
  fresh.pair.sourceBinding.head = fresh.pair.after.source.revision =
    "48c6f9035e9852c617e7b2eba145490b75ca0824";
  compare(fresh);
  for (const mutate of [
    (v: ReturnType<typeof control>) => {
      v.pair.before.source.revision = "f".repeat(40);
    },
    (v: ReturnType<typeof control>) => {
      v.pair.after.source.revision = "f".repeat(40);
    },
    (v: ReturnType<typeof control>) => {
      v.pair.sourceBinding.baseline = "f".repeat(40);
    },
    (v: ReturnType<typeof control>) => {
      v.pair.sourceBinding.head = "foreign";
    },
    (v: ReturnType<typeof control>) => {
      v.pair.sourceBinding.projectConfigHost = {};
    },
    (v: ReturnType<typeof control>) => {
      object(object(v.pair.sourceBinding.projectConfigHost).ownedCompletionContext).manifestSHA256 =
        "f".repeat(64);
    },
    (v: ReturnType<typeof control>) => {
      object(
        object(v.pair.sourceBinding.projectConfigHost).ownedCompletionContext,
      ).fixtureManifestSHA256 = "f".repeat(64);
    },
  ]) {
    const value = control();
    mutate(value);
    assert.throws(() => compare(value));
  }
  compare(control());
});

await test("the source successor binds both complete helpers and every declared extension before delegating", () => {
  const rows = new Map(ownedCompletionManifest.helperBodies.map((row) => [row[0], row]));
  const extensions = new Map(ownedCompletionManifest.extensions.map((row) => [row[0], row]));
  const digestFor = (side: "before" | "after", file: string) =>
    rows.has(file)
      ? rows.get(file)![side === "before" ? 1 : 3]
      : (extensions.get(file)?.[side === "before" ? 1 : 2] ?? null);
  const predecessor = (_files: string[], _owned: ReadonlySet<string>, read: typeof digestFor) =>
    [...rows].every(([file, row]) => read("after", file) === row[2])
      ? { files: ["actual-whole-original-authority"] }
      : null;
  assert.ok(qualifyOwnedCompletionHost([], new Set(), digestFor, predecessor));
  for (const scope of ["parent-pair", "inherited"] as const) {
    const currentDigest = (side: "before" | "after", file: string) =>
      digestFor(scope === "inherited" ? "after" : side, file);
    assert.ok(qualifyOwnedCompletionHost([], new Set(), currentDigest, predecessor, scope));
    for (const [file] of [...rows, ...extensions])
      for (const side of ["before", "after"] as const)
        for (const replacement of [null, "f".repeat(64)]) {
          if (replacement === currentDigest(side, file)) continue;
          assert.equal(
            qualifyOwnedCompletionHost(
              [],
              new Set(),
              (candidate, name) =>
                candidate === side && name === file ? replacement : currentDigest(candidate, name),
              predecessor,
              scope,
            ),
            null,
            `${scope}:${side}:${file}:${replacement}`,
          );
        }
  }
  for (const [file, , , after] of rows.values())
    assert.equal(
      digest(fs.readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)))),
      after,
    );
  for (const [file, , after] of extensions.values())
    assert.equal(
      digest(fs.readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)))),
      after,
    );
});
