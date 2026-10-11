import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { observations, retain } from "./bucket-observations.mjs";

const event =
  '2026-10-12T01:02:03.123456Z  INFO vize_editor_preparation: event="diagnostic_native_fact_buckets" pid=42 observe=true qualified=false full_facts=4 full_buckets=3 full_max=2 full_pairs=1 suffix_facts=4 suffix_buckets=2 suffix_max=3 suffix_pairs=3 suffix_over_eight_buckets=0 suffix_over_eight_facts=0 complete=true elapsed_us=199';

test("whole diagnostic events retain literal counts, false qualification and raw bytes", () => {
  assert.deepEqual(observations(`unrelated\n${event}\n`, { pid: 42 }), [
    {
      timestamp: "2026-10-12T01:02:03.123456Z",
      pid: 42,
      raw: event,
      full_facts: 4,
      full_buckets: 3,
      full_max: 2,
      full_pairs: "1",
      suffix_facts: 4,
      suffix_buckets: 2,
      suffix_max: 3,
      suffix_pairs: "3",
      suffix_over_eight_buckets: 0,
      suffix_over_eight_facts: 0,
      observe: true,
      qualified: false,
      complete: true,
      elapsed_us: "199",
    },
  ]);
});

test("different provider, missing whole fields and falsely complete prefixes refuse", () => {
  for (const line of [
    event.replace("pid=42", "pid=43"),
    event.replace(" full_pairs=1", ""),
    event.replace("suffix_facts=4", "suffix_facts=3"),
    event.replace("full_facts=4", "full_facts=9007199254740992"),
  ])
    assert.throws(() => observations(line, { pid: 42 }), assert.AssertionError);
  assert.throws(() => observations("unrelated", { pid: 42 }), assert.AssertionError);
});

test("incomplete cap refusal retains its actual prefix and never gains acceptance credit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-bucket-observation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "diagnostic-native-fact-buckets");
  const first = path.join(root, "authored-registry");
  fs.mkdirSync(path.join(output, "consumer"), { recursive: true });
  fs.mkdirSync(first);
  const inputs = [{ file: "original.vue", sha256: "whole-original", bytes: 9 }];
  const write = (file, data) => fs.writeFileSync(path.join(output, file), JSON.stringify(data));
  write("owned-process.json", { checkout: "exact-source", pid: 42 });
  write("consumer/source-inputs-before.json", {
    checkout: "exact-source",
    originalInputs: inputs,
    oracle: { original: true },
  });
  write("consumer/source-inputs-after.json", inputs);
  for (const name of ["source-inputs-before.json", "source-inputs-after.json"])
    fs.copyFileSync(path.join(output, "consumer", name), path.join(first, name));
  fs.writeFileSync(path.join(first, "stderr.txt"), "whole first unprofiled stderr\n");
  fs.writeFileSync(
    path.join(first, "complete.json"),
    JSON.stringify({ status: "failed", failure: "original timeout" }),
  );
  const partial = event
    .replace("full_facts=4", "full_facts=5")
    .replace("complete=true", "complete=false");
  fs.writeFileSync(path.join(output, "consumer/stderr.txt"), partial);
  retain(output);
  const packet = JSON.parse(fs.readFileSync(path.join(output, "observations.json"), "utf8"));
  assert.equal(packet.diagnosticOnly, true);
  assert.equal(packet.acceptanceCredit, "none");
  assert.equal(packet.complete, false);
  assert.equal(packet.packets[0].full_facts, 5);
  assert.equal(packet.packets[0].suffix_facts, 4);
  assert.deepEqual(packet.originalInputs, inputs);
  assert.deepEqual(packet.oracle, { original: true });
  assert.deepEqual(packet.firstCampaign.complete, {
    status: "failed",
    failure: "original timeout",
  });
  fs.writeFileSync(path.join(first, "stderr.txt"), event);
  assert.throws(() => retain(output), assert.AssertionError);
  fs.writeFileSync(path.join(first, "stderr.txt"), "whole first unprofiled stderr\n");
  write("consumer/source-inputs-after.json", []);
  assert.throws(() => retain(output), assert.AssertionError);
});
