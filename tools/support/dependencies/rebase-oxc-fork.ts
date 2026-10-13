// Move a vendored OXC fork to a newer upstream revision with a three-way merge.
//
// Usage:
//   vp node tools/support/dependencies/rebase-oxc-fork.ts OXC_CLONE CRATE FROM_REV TO_REV
//
// OXC_CLONE is a local clone of https://github.com/oxc-project/oxc that contains
// both revisions. CRATE is `oxc_parser` or `oxc_formatter`. FROM_REV is the
// upstream revision the fork was taken from; TO_REV is the new one.
//
// The merge base is upstream FROM_REV, "ours" is the current `vendor/CRATE`,
// and "theirs" is upstream TO_REV. Files the fork deliberately omits (upstream
// tests, examples, build scripts) stay omitted. The merged tree replaces
// `vendor/CRATE`; conflicted files keep their markers and are listed on stdout
// for manual resolution. Fork-only files (LICENSE, UPSTREAM.md, local modules)
// are kept as they are.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [clone, crate, fromRev, toRev] = process.argv.slice(2);
if (!clone || !crate || !fromRev || !toRev) {
  throw new Error("usage: rebase-oxc-fork.ts OXC_CLONE CRATE FROM_REV TO_REV");
}
if (!["oxc_parser", "oxc_formatter"].includes(crate)) {
  throw new Error(`unsupported crate: ${crate}`);
}
const vendor = path.resolve("vendor", crate);

function run(cwd: string, command: string, args: string[], allowFailure = false): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function replaceTree(directory: string, source: string): void {
  for (const entry of readdirSync(directory)) {
    if (entry !== ".git") rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
  cpSync(source, directory, { recursive: true });
}

function exportUpstream(revision: string, destination: string): void {
  const archive = spawnSync("git", ["-C", clone, "archive", revision, `crates/${crate}`], {
    maxBuffer: 512 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error(archive.stderr.toString());
  const extract = spawnSync("tar", ["-x", "-C", destination], { input: archive.stdout });
  if (extract.status !== 0) throw new Error(extract.stderr.toString());
}

const work = mkdtempSync(path.join(os.tmpdir(), `vize-${crate}-rebase-`));
try {
  for (const revision of [fromRev, toRev]) {
    const destination = path.join(work, revision);
    run(work, "mkdir", ["-p", destination]);
    exportUpstream(revision, destination);
  }
  const repo = path.join(work, "merge");
  run(work, "git", ["init", "-q", "-b", "base", repo]);
  run(repo, "git", ["config", "user.name", "rebase-oxc-fork"]);
  run(repo, "git", ["config", "user.email", "rebase-oxc-fork@localhost"]);
  const commit = (message: string) => {
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "--allow-empty", "-m", message]);
  };
  replaceTree(repo, path.join(work, fromRev, "crates", crate));
  commit(`upstream ${fromRev}`);
  run(repo, "git", ["checkout", "-q", "-b", "upstream"]);
  replaceTree(repo, path.join(work, toRev, "crates", crate));
  commit(`upstream ${toRev}`);
  run(repo, "git", ["checkout", "-q", "base"]);
  run(repo, "git", ["checkout", "-q", "-b", "fork"]);
  replaceTree(repo, vendor);
  commit("vize fork");
  run(repo, "git", ["merge", "-q", "--no-edit", "upstream"], true);

  // Keep the fork's omissions: upstream changes to files the fork deleted stay out,
  // and so do files upstream added under a top-level path the fork does not carry.
  const status = run(repo, "git", ["status", "--porcelain"]).split("\n").filter(Boolean);
  const omitted = status.filter((line) => line.startsWith("DU ")).map((line) => line.slice(3));
  if (omitted.length > 0) run(repo, "git", ["rm", "-q", "--", ...omitted]);
  const forkRoots = new Set(readdirSync(vendor));
  const baseRoots = readdirSync(path.join(work, fromRev, "crates", crate));
  const omittedRoots = baseRoots.filter((entry) => !forkRoots.has(entry));
  const added = run(repo, "git", ["diff", "--cached", "--name-only", "--diff-filter=A", "HEAD"])
    .split("\n")
    .filter((file) => file && omittedRoots.includes(file.split("/")[0]));
  if (added.length > 0) run(repo, "git", ["rm", "-q", "--cached", "--", ...added]);
  for (const file of added) rmSync(path.join(repo, file), { force: true });
  omitted.push(...added);
  const conflicted = run(repo, "git", ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);

  rmSync(path.join(repo, ".git"), { recursive: true, force: true });
  replaceTree(vendor, repo);
  process.stdout.write(
    `${crate}: ${fromRev} -> ${toRev}; kept ${omitted.length} fork omissions\n` +
      (conflicted.length > 0
        ? `resolve conflict markers in:\n${conflicted.map((file) => `  vendor/${crate}/${file}`).join("\n")}\n`
        : "no conflicts\n"),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
