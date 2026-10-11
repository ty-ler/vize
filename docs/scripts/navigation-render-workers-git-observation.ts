import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileCustody } from "./navigation-render-workers-custody.ts";

/** Retain original Git vectors before the unchanged source classifier can refuse. */
export async function retainWorkersGitObservation(
  root: string,
  output: string,
  source: string,
  phase: "prepare" | "qualify",
) {
  assert.equal(await realpath(root), root, "Physical checkout root required");
  assert.equal(await realpath(output), output, "Physical evidence root required");
  assert.match(source, /^[a-f0-9]{40}$/);
  const git = (...args: string[]) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    });
  assert.equal(git("rev-parse", "HEAD").toString("utf8").trim(), source);
  const status = git("status", "--porcelain", "-z", "--untracked-files=all");
  const index = git("ls-files", "--stage", "-z");
  const paths: Buffer[] = [];
  for (let start = 0; start < index.length;) {
    const end = index.indexOf(0, start);
    assert(end >= start, "Complete original NUL index vector required");
    const separator = index.indexOf(9, start);
    assert(separator > start && separator < end, "Original index path separator required");
    paths.push(index.subarray(separator + 1, end + 1));
    start = end + 1;
  }
  const directory = path.join(output, `git-${phase}`);
  await mkdir(directory); // Never replace evidence from a previous observation.
  const vectors = [];
  for (const [name, bytes] of [
    ["status.z", status],
    ["index.z", index],
    ["source-paths.z", Buffer.concat(paths)],
  ] as const) {
    const file = path.join(directory, name);
    await writeFile(file, bytes, { flag: "wx" });
    vectors.push({ ...(await fileCustody(file)), file: name });
  }
  const observation = {
    schemaVersion: 1,
    source,
    tree: git("rev-parse", "HEAD^{tree}").toString("utf8").trim(),
    phase,
    vectors,
  };
  await writeFile(
    path.join(directory, "observation.json"),
    JSON.stringify(observation, null, 2) + "\n",
    { flag: "wx" },
  );
  return observation;
}
