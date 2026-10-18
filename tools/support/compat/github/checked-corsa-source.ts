/** Verify the checked Corsa graph's complete upstream source census and licenses. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALIASES, digest, files, requireThat, sameSet } from "./checked-corsa-contract.ts";

export function verifySource(root: string) {
  const lines = fs
    .readFileSync(path.join(root, "vendor/corsa-source.tsv"), "utf8")
    .trimEnd()
    .split(/\r?\n/u);
  const columns = lines.shift()!.split("\t"),
    expected = new Set<string>();
  for (const line of lines) {
    const values = line.split("\t");
    requireThat(values.length === columns.length, "invalid source census row");
    const record = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    const relative = record.path;
    requireThat(
      ALIASES.includes(record.package) &&
        relative &&
        !path.posix.isAbsolute(relative) &&
        !relative.includes("\\") &&
        relative.split("/").every((part) => part && part !== "." && part !== ".."),
      "unexpected package/source path",
    );
    const member = `${record.package}/${relative}`,
      target = path.join(root, "vendor", member);
    requireThat(!expected.has(member), `missing, duplicate or replaced source: ${member}`);
    let cursor = path.join(root, "vendor");
    for (const component of member.split("/")) {
      cursor = path.join(cursor, component);
      requireThat(!fs.lstatSync(cursor, { bigint: true }).isSymbolicLink(), "replaced source path");
    }
    requireThat(
      fs.lstatSync(target, { bigint: true }).isFile(),
      `missing, duplicate or replaced source: ${member}`,
    );
    expected.add(member);
    const body = fs.readFileSync(target);
    requireThat(
      /^[0-9]+$/u.test(record.bytes) &&
        BigInt(body.length) === BigInt(record.bytes) &&
        digest(body) === record.sha256,
      `imported source changed: ${member}`,
    );
  }
  const actual = ALIASES.flatMap((alias) =>
    files(path.join(root, "vendor", alias)).map((name) => `${alias}/${name}`),
  );
  sameSet(actual, expected);
  const licenses = ALIASES.map((alias) =>
    fs.readFileSync(path.join(root, "vendor", alias, "LICENSE")),
  );
  requireThat(
    licenses.every((license) => license.equals(licenses[0])) && licenses[0].includes("MIT License"),
    "all imported packages must retain the same complete upstream MIT notice",
  );
  console.log(
    `Verified ${lines.length} checked Corsa source members and six complete MIT notices.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifySource(path.resolve(process.argv[2] ?? "."));
