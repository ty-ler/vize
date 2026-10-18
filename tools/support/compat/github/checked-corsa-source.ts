/** Verify the checked Corsa graph's complete upstream source census and licenses. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALIASES, digest, files, requireThat, sameSet } from "./checked-corsa-contract.ts";

export function verifySource(root: string) {
  const head = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
    cwd: root,
  })
    .toString()
    .trim();
  const reader = ownedCorsaReader(root, head, head);
  const pinned = (file: string) => {
    const value = reader("after", file);
    requireThat(value, `registered current source is absent from Git: ${file}`);
    return value.body;
  };
  const lines = pinned("vendor/corsa-source.tsv").toString("utf8").trimEnd().split(/\r?\n/u);
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
    const body = pinned(`vendor/${member}`);
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
  const licenses = ALIASES.map((alias) => pinned(`vendor/${alias}/LICENSE`));
  requireThat(
    licenses.every((license) => license.equals(licenses[0])) && licenses[0].includes("MIT License"),
    "all imported packages must retain the same complete upstream MIT notice",
  );
  console.log(
    `Verified ${lines.length} checked Corsa source members and six complete MIT notices.`,
  );
}
/** Authenticate selected raw Git objects and fresh physical source on every call.
 * These added Git reads are separate from the frozen package command oracle. */
export function ownedCorsaReader(root: string, baseline: string, head: string) {
  root = fs.realpathSync(root);
  const git = (args: string[]) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
  for (const revision of [baseline, head])
    requireThat(/^[a-f0-9]{40}$/u.test(revision), "exact source revision required");
  const current = () => {
    requireThat(git(["rev-parse", "HEAD"]).toString().trim() === head, "source HEAD changed");
    requireThat(
      git(["for-each-ref", "--format=%(refname)", "refs/replace"]).length === 0,
      "replacement refs refuse source publication",
    );
  };
  current();
  return (side: string, file: string) => {
    current();
    requireThat(["before", "after"].includes(side), "unknown source side");
    requireThat(
      file &&
        !path.isAbsolute(file) &&
        !/[\\\0]/u.test(file) &&
        file.split("/").every((part) => part && part !== "." && part !== ".."),
      "invalid raw source path",
    );
    const entry = git(["ls-tree", "-z", side === "before" ? baseline : head, "--", file]);
    if (!entry.length) {
      current();
      return null;
    }
    const match = /^100644 blob ([a-f0-9]{40})\t(.+)\0$/u.exec(entry.toString());
    requireThat(match && match[2] === file, `one complete regular raw source: ${file}`);
    const body = git(["cat-file", "blob", match[1]]);
    if (side === "after") {
      let component = root;
      requireThat(!fs.lstatSync(component).isSymbolicLink(), "replaced source root");
      for (const part of file.split("/")) {
        component = path.join(component, part);
        requireThat(
          !fs.lstatSync(component).isSymbolicLink(),
          `physical source ancestor: ${component}`,
        );
      }
      const stat = fs.lstatSync(component);
      requireThat(
        stat.isFile() && (stat.mode & 0o7777) === 0o644,
        `physical regular source: ${file}`,
      );
      requireThat(
        fs.readFileSync(component).equals(body),
        `physical body equals selected raw Git: ${file}`,
      );
    }
    current();
    return { mode: "100644", blob: match[1], body: Buffer.from(body) };
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifySource(path.resolve(process.argv[2] ?? "."));
