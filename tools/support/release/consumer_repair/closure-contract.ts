import assert from "node:assert/strict";
import { object, repair457, type ObjectValue } from "./contract.ts";

export function verifyFrozenCustody(snapshot: Record<string, ObjectValue>) {
  const {
    source,
    sourceBranch,
    tagRef,
    tag,
    head,
    integration,
    delivery,
    pin,
    pinCommit,
    release,
  } = snapshot;
  assert.equal(source!.number, 9196);
  assert.equal(source!.state, "open");
  assert.equal(source!.draft, true);
  assert.equal(source!.merged, false);
  assert.equal(source!.merged_at, null);
  assert.equal(object(source!.head).sha, repair457.head);
  assert.equal(object(source!.head).ref, "release/v0.457.0");
  assert.equal(object(object(source!.head).repo).full_name, repair457.repository);
  assert.equal(object(source!.base).ref, "main");
  assert.equal(object(object(source!.base).repo).full_name, repair457.repository);
  assert.equal(object(sourceBranch!.object).sha, repair457.head);
  assert.equal(object(tagRef!.object).sha, repair457.tagObject);
  assert.equal(object(tagRef!.object).type, "tag");
  assert.equal(tag!.tag, repair457.tag);
  assert.equal(object(tag!.object).sha, repair457.head);
  assert.equal(object(tag!.object).type, "commit");
  const tree = "e2d1150ff4aa1aa5d8dc6a82ecb2fa43da56ac78";
  assert.equal(object(head!.tree).sha, tree);
  assert.deepEqual(
    (head!.parents as ObjectValue[]).map((p) => p.sha),
    [repair457.cut],
  );
  assert.equal(integration!.number, 9197);
  assert.equal(integration!.merged, true);
  const merged = "b4be3b70977b80a689c8e5ada62d05283e86b868";
  assert.equal(integration!.merge_commit_sha, merged);
  assert.equal(delivery!.sha, merged);
  assert.equal(object(delivery!.tree).sha, tree);
  assert.deepEqual(
    (delivery!.parents as ObjectValue[]).map((p) => p.sha),
    [repair457.cut],
  );
  assert.equal(object(delivery!.verification).verified, true);
  assert.equal(object(delivery!.verification).reason, "valid");
  assert.equal(object(pin!.object).sha, pinCommit!.sha);
  assert.equal(object(pinCommit!.tree).sha, tree);
  assert.deepEqual(
    (pinCommit!.parents as ObjectValue[]).map((p) => p.sha),
    [repair457.head],
  );
  for (const [name, value] of Object.entries({
    "Source-PR": "#9196",
    "Source-head": repair457.head,
    "Source-cut": repair457.cut,
    Tag: repair457.tag,
    "Integration-PR": "#9197",
  }))
    assert.equal(
      String(pinCommit!.message)
        .split("\n")
        .filter((line) => line.startsWith(`${name}: `))
        .join("\n"),
      `${name}: ${value}`,
    );
  for (const [name, value] of Object.entries({
    "Release-Mode": "pinned",
    "Release-PR": "#9196",
    "Validated-run": String(repair457.run),
    "Validated-head": repair457.head,
    "Validated-base": repair457.cut,
    "Integration-PR": "#9197",
    "Integration-head": "2c8a83c6858e8e46424ce578b5cfa7a0b1dbeafb",
    "Integration-merge": merged,
    "Integration-parent": repair457.cut,
    "Protected-candidate": merged,
  }))
    assert.equal(
      String(tag!.message)
        .split("\n")
        .filter((line) => line.startsWith(`${name}: `))
        .join("\n"),
      `${name}: ${value}`,
    );
  for (const [name, value] of Object.entries({
    "vize-release-pin": "immutable-v1",
    "vize-release-pin-cut": repair457.cut,
    "vize-release-pin-head": repair457.head,
    "vize-release-integration": "9197",
  })) {
    assert.equal(String(source!.body).split(`<!-- ${name}: `).length, 2);
    assert.ok(String(source!.body).includes(`<!-- ${name}: ${value} -->`));
  }
  assert.equal(release!.id, 414307189);
  assert.equal(release!.tag_name, repair457.tag);
  assert.equal(release!.draft, false);
  assert.equal(release!.prerelease, false);
}

export function closureIntent(operatorRun: number, supplementalRun: number, policyHead: string) {
  assert.ok(Number.isSafeInteger(operatorRun) && operatorRun > 0);
  assert.ok(
    Number.isSafeInteger(supplementalRun) && supplementalRun > 0 && supplementalRun !== operatorRun,
  );
  assert.match(policyHead, /^[0-9a-f]{40}$/);
  return `Public v0.457.0 verified with the unchanged H consumer and supplemental Deno operator #${supplementalRun} at ${policyHead}. Original Release #38805261385 attempt 4 remains failed; its other 55 jobs and published artifacts are preserved. Closing only this unmerged source receipt; integration #9197 is merged.\n\n<!-- vize-457-composite-close: ${operatorRun}:${supplementalRun}:${policyHead} -->`;
}

export function requireClosureMutation(
  method: string,
  path: string,
  payload: unknown,
  intent: string,
) {
  if (method === "POST" && path === "issues/9196/comments")
    assert.deepEqual(payload, { body: intent });
  else {
    assert.equal(method, "PATCH");
    assert.equal(path, "pulls/9196");
    assert.deepEqual(payload, { state: "closed" });
  }
}
