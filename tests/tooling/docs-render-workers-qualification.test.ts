import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import {
  packet,
  qualifyWorkersPair,
  workersArmEvidence,
} from "../../docs/scripts/navigation-render-workers-evidence.ts";
import { treeCustody } from "../../docs/scripts/navigation-render-workers-custody.ts";
import { assertWorkersEvidenceEqual } from "../../docs/scripts/navigation-render-workers-equality.ts";
import {
  fixtureExpected,
  prepareWorkersArm,
  writePacket,
} from "./fixtures/docs-render-workers-fixture.ts";

test("large whole packets keep exact equality and bounded refusal diagnostics", () => {
  const original = {
    reports: Array.from({ length: 12_000 }, (_, index) => ({
      index,
      source: `original/${index}`,
      body: "preserved source body ".repeat(12),
      png: "a".repeat(64),
    })),
  };
  const copy = structuredClone(original);
  assertWorkersEvidenceEqual(original, copy);
  let changedCase = 0;
  for (const change of [
    () => {
      copy.reports.at(-1)!.png = "b".repeat(64);
    },
    () => {
      copy.reports.at(-1)!.body = "private-body-marker".repeat(100_000);
    },
    () => {
      Object.assign(copy.reports.at(-1)!, {
        ["unknown-field-marker".repeat(1_000)]: { nested: [true, false] },
      });
    },
    () => {
      for (const report of copy.reports) report.png = "b".repeat(64);
    },
  ]) {
    const changed = structuredClone(original);
    copy.reports = changed.reports;
    change();
    const leafCount = [1, 1, 2, 12_000][changedCase++];
    assert.throws(
      () => assertWorkersEvidenceEqual(original, copy),
      (error: unknown) => {
        assert(error instanceof assert.AssertionError);
        assert(Buffer.byteLength(error.message) < 1_024);
        assert(!Object.hasOwn(error, "actual") && !Object.hasOwn(error, "expected"));
        assert(!error.message.includes("private-body-marker"));
        assert(!error.message.includes("unknown-field-marker".repeat(10)));
        assert.match(error.message, new RegExp(`: ${leafCount} leaf differences;`));
        assert(error.message.includes(`path=$["reports"][${leafCount === 12_000 ? 0 : 11_999}]`));
        assert.equal(isDeepStrictEqual(original, copy), false);
        return true;
      },
    );
  }
  assert.throws(
    () => assertWorkersEvidenceEqual({ original: { kept: [1, 2] } }, {}),
    /2 leaf differences/,
  );
  assert.throws(
    () => assertWorkersEvidenceEqual({}, { future: { kept: [1, 2, 3] } }),
    /3 leaf differences/,
  );
  assert.throws(() => assertWorkersEvidenceEqual({}, Object.create(null)));
  assert.throws(() => assertWorkersEvidenceEqual(null, { far: [1, 2] }), /3 leaf differences/);
});

test("whole 119-route two/four qualification retains every original packet and raw PNG", async () => {
  const temporary = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "vize-workers-qualification-")),
  );
  try {
    const baseline = path.join(temporary, "two");
    const candidate = path.join(temporary, "four");
    await prepareWorkersArm(baseline, 2);
    await prepareWorkersArm(candidate, 4);
    const qualified = await qualifyWorkersPair(baseline, candidate, fixtureExpected);
    assert.equal(qualified.status, "passed");
    assert.equal(qualified.pages, 238);
    assert.deepEqual(
      qualified.arms.map(({ workers, overlap }) => [workers, overlap]),
      [
        [2, 2],
        [4, 4],
      ],
    );
    const first = (value: unknown) => packet((value as unknown[])[0]);
    const last = (value: unknown) => packet((value as unknown[]).at(-1));
    const negatives: {
      name: string;
      file: string;
      change: (value: Record<string, unknown>) => void;
    }[] = [
      {
        name: "source substitution",
        file: "capture-timings.json",
        change: (value) => {
          value.source = "b".repeat(40);
        },
      },
      {
        name: "different built dist",
        file: "receipt.json",
        change: (value) => {
          value.dist = "/substituted/dist";
        },
      },
      {
        name: "partial route census",
        file: "timings.json",
        change: (value) => {
          (value.jobs as unknown[]).pop();
        },
      },
      {
        name: "different page device",
        file: "receipt.json",
        change: (value) => {
          first(value.reports).device = "mobile";
        },
      },
      {
        name: "failed context cleanup",
        file: "timings.json",
        change: (value) => {
          last(first(value.jobs).phases).status = "failed";
        },
      },
      {
        name: "missing original phase",
        file: "timings.json",
        change: (value) => {
          (first(value.jobs).phases as unknown[]).splice(1, 1);
        },
      },
      {
        name: "missing original theme",
        file: "receipt.json",
        change: (value) => {
          (first(value.reports).themeScreenshots as unknown[]).pop();
        },
      },
      {
        name: "missing installed glyph provider",
        file: "receipt.json",
        change: (value) => {
          (value.reports as Record<string, unknown>[]).find(({ route }) =>
            String(route).startsWith("/ja/"),
          )!.japaneseFonts = [];
        },
      },
      {
        name: "different whole query",
        file: "receipt.json",
        change: (value) => {
          first(value.reports).links = [
            "http://127.0.0.1:41004/linked/?changed#same-hash",
            "https://example.com/untouched?q=1#original",
          ];
        },
      },
      {
        name: "unknown workers",
        file: "timings.json",
        change: (value) => {
          value.workers = 3;
        },
      },
      {
        name: "missing native locale case",
        file: "locale-controls/receipt.json",
        change: (value) => {
          (value.cases as unknown[]).pop();
        },
      },
      {
        name: "falsely accepted native text control",
        file: "capture-controls/receipt.json",
        change: (value) => {
          packet(value.enlarged).text = packet(value.before).text;
        },
      },
      {
        name: "missing separate scroll checkpoint",
        file: "capture-timings.json",
        change: (value) => {
          const events = value.events as Record<string, unknown>[];
          events.splice(
            events.findIndex(({ phase }) => phase === "tile-position"),
            1,
          );
        },
      },
      {
        name: "unclosed native capture operation",
        file: "capture-timings.json",
        change: (value) => {
          first(value.events).status = "running";
        },
      },
      {
        name: "unknown native capture checkpoint",
        file: "capture-timings.json",
        change: (value) => {
          first(value.events).phase = "combined-scroll-and-capture";
        },
      },
      {
        name: "four-label without actual four contexts",
        file: "timings.json",
        change: (value) => {
          for (const [index, item] of (value.jobs as Record<string, unknown>[]).entries()) {
            const start = Date.parse(String(item.startedAt)) + index * 1000;
            item.startedAt = new Date(start).toISOString();
            for (const [phaseIndex, phase] of (item.phases as Record<string, unknown>[]).entries())
              phase.startedAt = new Date(start + phaseIndex * 20).toISOString();
          }
        },
      },
    ];
    for (const negative of negatives) {
      const original = await readFile(path.join(candidate, negative.file), "utf8");
      const value = packet(JSON.parse(original));
      negative.change(value);
      await writePacket(candidate, negative.file, value);
      await assert.rejects(
        () => qualifyWorkersPair(baseline, candidate, fixtureExpected),
        { name: "AssertionError" },
        negative.name,
      );
      await writeFile(path.join(candidate, negative.file), original);
    }
    for (const substitution of ["dist", "source"] as const) {
      const files =
        substitution === "dist"
          ? ["receipt.json", "timings.json", "capture-timings.json"]
          : ["locale-controls/receipt.json"];
      const originals: { dir: string; file: string; bytes: string }[] = [];
      for (const dir of [baseline, candidate]) {
        for (const file of files) {
          const bytes = await readFile(path.join(dir, file), "utf8");
          originals.push({ dir, file, bytes });
          const value = packet(JSON.parse(bytes));
          if (substitution === "dist") value.dist = "/paired/substituted/dist";
          else first(value.source).sha256 = "d".repeat(64);
          await writePacket(dir, file, value);
        }
      }
      await assert.rejects(
        () => qualifyWorkersPair(baseline, candidate, fixtureExpected),
        { name: "AssertionError" },
        `Identically substituted ${substitution} in both arms must refuse physical custody`,
      );
      for (const { dir, file, bytes } of originals) await writeFile(path.join(dir, file), bytes);
    }
    const screenshot = "000-home-desktop.png";
    const image = await readFile(path.join(candidate, screenshot));
    await rm(path.join(candidate, screenshot));
    await assert.rejects(
      () => qualifyWorkersPair(baseline, candidate, fixtureExpected),
      /ENOENT/,
      "Missing original raw PNG refuses",
    );
    await writeFile(
      path.join(candidate, screenshot),
      await readFile(path.join(candidate, "119-home-mobile.png")),
    );
    await assert.rejects(
      () => qualifyWorkersPair(baseline, candidate, fixtureExpected),
      /custody/,
      "Swapped original raw PNG refuses",
    );
    await writeFile(path.join(candidate, screenshot), image);
    await assert.rejects(
      () => workersArmEvidence(candidate, 2, fixtureExpected),
      /worker/,
      "Different arm is refused",
    );
    assert.equal(
      (await qualifyWorkersPair(baseline, candidate, fixtureExpected)).status,
      "passed",
      "Original full packet still qualifies after every negative",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("whole physical custody refuses symlinked files and partial empty trees", async () => {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "vize-workers-custody-")));
  try {
    await assert.rejects(() => treeCustody(temporary), /Empty custody/);
    await writeFile(path.join(temporary, "original"), "actual original bytes");
    assert.equal((await treeCustody(temporary)).length, 1);
    await symlink(path.join(temporary, "original"), path.join(temporary, "alias"));
    await assert.rejects(() => treeCustody(temporary), /Substituted tree link/);
    await rm(path.join(temporary, "alias"));
    await mkdir(path.join(temporary, "linked-parent"));
    await symlink(temporary, path.join(temporary, "linked-parent/substitute"));
    await assert.rejects(() => treeCustody(temporary), /Substituted tree link/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
