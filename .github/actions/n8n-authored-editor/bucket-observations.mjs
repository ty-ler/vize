import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const counts = [
  "full_facts",
  "full_buckets",
  "full_max",
  "suffix_facts",
  "suffix_buckets",
  "suffix_max",
  "suffix_over_eight_buckets",
  "suffix_over_eight_facts",
];
const decimals = ["full_pairs", "suffix_pairs", "elapsed_us"];

function field(line, name, pattern) {
  const match = line.match(new RegExp(`(?:^| )${name}=(${pattern})(?: |$)`, "u"));
  assert.ok(match, `missing or invalid ${name} in complete bucket event`);
  return match[1];
}

/** Retain numeric diagnostic records from the authenticated provider only. */
export function observations(stderr, owned) {
  assert.ok(Number.isSafeInteger(owned.pid) && owned.pid > 0);
  const packets = [];
  for (const line of stderr.split("\n")) {
    if (!line.includes('event="diagnostic_native_fact_buckets"')) continue;
    const pid = Number(field(line, "pid", "[0-9]+"));
    assert.equal(pid, owned.pid, "bucket event must come from the actual owned provider");
    const packet = { timestamp: line.split(" ")[0], pid, raw: line };
    assert.ok(Number.isFinite(Date.parse(packet.timestamp)));
    for (const name of counts) {
      packet[name] = Number(field(line, name, "[0-9]+"));
      assert.ok(Number.isSafeInteger(packet[name]));
    }
    for (const name of decimals) packet[name] = field(line, name, "[0-9]+");
    for (const name of ["observe", "qualified", "complete"])
      packet[name] = field(line, name, "true|false") === "true";
    assert.ok(packet.suffix_facts <= packet.full_facts);
    assert.ok(packet.suffix_facts <= 500_000 && packet.suffix_buckets <= 131_072);
    assert.equal(packet.complete, packet.suffix_facts === packet.full_facts);
    for (const prefix of ["full", "suffix"]) {
      assert.ok(packet[`${prefix}_buckets`] <= packet[`${prefix}_facts`]);
      assert.ok(packet[`${prefix}_max`] <= packet[`${prefix}_facts`]);
      const facts = BigInt(packet[`${prefix}_facts`]);
      assert.ok(BigInt(packet[`${prefix}_pairs`]) <= (facts * (facts - 1n)) / 2n);
    }
    packets.push(packet);
  }
  assert.ok(packets.length > 0, "the separate capture must retain actual numeric bucket events");
  return packets;
}

export function retain(output) {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(output, file), "utf8"));
  const owned = read("owned-process.json");
  const before = read("consumer/source-inputs-before.json");
  const after = read("consumer/source-inputs-after.json");
  assert.equal(before.checkout, owned.checkout);
  assert.deepEqual(after, before.originalInputs);
  const first = path.join(path.dirname(output), "authored-registry");
  const original = JSON.parse(
    fs.readFileSync(path.join(first, "source-inputs-before.json"), "utf8"),
  );
  assert.deepEqual(original, before, "the second capture retains the complete first workload");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(first, "source-inputs-after.json"), "utf8")),
    after,
  );
  const firstStderr = fs.readFileSync(path.join(first, "stderr.txt"));
  assert.ok(
    !firstStderr.includes('event="diagnostic_native_fact_buckets"'),
    "the original first campaign must have the diagnostic flag unset",
  );
  const packets = observations(
    fs.readFileSync(path.join(output, "consumer/stderr.txt"), "utf8"),
    owned,
  );
  fs.writeFileSync(
    path.join(output, "observations.json"),
    `${JSON.stringify(
      {
        diagnosticOnly: true,
        acceptanceCredit: "none",
        checkout: owned.checkout,
        pid: owned.pid,
        complete: packets.every((packet) => packet.complete),
        firstCampaign: {
          directory: first,
          stderrSha256: createHash("sha256").update(firstStderr).digest("hex"),
          complete: JSON.parse(fs.readFileSync(path.join(first, "complete.json"), "utf8")),
        },
        originalInputs: before.originalInputs,
        oracle: before.oracle,
        packets,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  assert.ok(process.argv[2], "diagnostic output directory is required");
  retain(path.resolve(process.argv[2]));
}
