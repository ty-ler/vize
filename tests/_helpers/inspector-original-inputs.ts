import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppConfig } from "./apps.ts";

export interface InspectorOriginalInput {
  path: string;
  source: string;
}

/** A fixed Gitlink, never an observed report, is the original-source authority. */
export interface InspectorSourceAuthority {
  gitlink: string;
}

export function assertInspectorFileCoverage(
  report: {
    target: "dom" | "ssr";
    summary: { fileCount: number };
    files: ReadonlyArray<{ path: string }>;
  },
  expected: readonly InspectorOriginalInput[],
  input?: unknown,
): void {
  const names = expected.map((file) => inspectorPath(file.path)).sort();
  assert.ok(names.length > 0, "inspector fixtures must contain original source inputs");
  assert.equal(new Set(names).size, names.length, "original source identities must be unique");
  assert.deepEqual(
    report.files.map((file) => inspectorPath(file.path)).sort(),
    names,
    "inspector must compare every original source exactly once",
  );
  assert.equal(report.summary.fileCount, names.length, "inspector source count");
  if (input === undefined) return;
  assert.ok(input !== null && typeof input === "object" && "target" in input && "files" in input);
  assert.equal(input.target, report.target, "same-invocation official target");
  assert.ok(Array.isArray(input.files), "same-invocation official inputs");
  const files = input.files.map((file: unknown) => {
    assert.ok(file !== null && typeof file === "object" && "path" in file && "source" in file);
    assert.equal(typeof file.path, "string");
    assert.equal(typeof file.source, "string");
    return { path: inspectorPath(String(file.path)), source: file.source };
  });
  assert.deepEqual(
    files.map((file) => file.path).sort(),
    names,
    "official input must contain every original source exactly once",
  );
  const sources = new Map(expected.map((file) => [inspectorPath(file.path), file.source]));
  for (const file of files)
    assert.equal(
      file.source,
      sources.get(file.path),
      `same-invocation original source: ${file.path}`,
    );
}

function inspectorPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  assert.ok(
    normalized && !normalized.includes("\0") && !normalized.includes(":"),
    "relative source path",
  );
  assert.ok(
    normalized.split("/").every((part) => part && part !== "." && part !== ".."),
    "source paths must retain exact relative identity",
  );
  return normalized;
}

/** Admit only policies proven unable to exclude any original member. */
export function assertInspectorPolicyDisjoint(policy: string, candidates: readonly string[]): void {
  for (const line of policy.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#") || line.startsWith("!")) continue;
    assert.ok(!line.includes("\\") && line === line.trimEnd(), "unsupported ignore policy syntax");
    const anchored = line.startsWith("/") || line.replace(/\/$/, "").includes("/");
    const pattern = line.replace(/^\//, "").replace(/\/$/, "");
    assert.ok(
      pattern && !pattern.split("/").some((part) => part === "." || part === ".."),
      "unsupported ignore policy identity",
    );
    const prefix = pattern.split(/[?*[\]{}]/, 1)[0];
    const literal = prefix === pattern;
    const suffix = /^\*[^/?*[\]{}]+$/.test(pattern) ? pattern.slice(1) : null;
    // Every literal component is necessary even when ** spans zero or more directories.
    const required =
      pattern.includes("/") && !/[?[\]{}]/.test(pattern)
        ? pattern.split("/").filter((part) => part && !part.includes("*"))
        : [];
    assert.ok(
      candidates.every((candidate) => {
        const parts = candidate.split("/");
        if (literal)
          return anchored
            ? candidate !== pattern && !candidate.startsWith(`${pattern}/`)
            : !parts.includes(pattern);
        if (suffix) return !parts.some((part) => part.endsWith(suffix));
        if (required.some((part) => !parts.includes(part))) return true;
        return (
          Boolean(prefix) &&
          (anchored
            ? !candidate.startsWith(prefix)
            : !parts.some((part) => part.startsWith(prefix)))
        );
      }),
      `ignore policy may exclude original input: ${line}`,
    );
  }
}

export function inspectorOriginalInputs(
  repositoryRoot: string,
  check: NonNullable<AppConfig["check"]>,
  authority: InspectorSourceAuthority,
  directory: string,
): InspectorOriginalInput[] {
  const observations: Array<Record<string, unknown>> = [];
  let failure: string | null = null;
  let pin: string | undefined;
  const command = (cwd: string, args: string[]) => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10_000,
    });
    observations.push({
      command: ["git", ...args],
      cwd,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message ?? null,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `original-source Git authority refused: ${result.stderr}`);
    return result.stdout;
  };
  const inspect = (file: string) => {
    try {
      const stat = fs.lstatSync(file);
      observations.push({
        policyIdentity: file,
        kind: stat.isSymbolicLink()
          ? "symlink"
          : stat.isFile()
            ? "file"
            : stat.isDirectory()
              ? "directory"
              : "other",
        ...(stat.isSymbolicLink()
          ? { targetHex: fs.readlinkSync(file, { encoding: "buffer" }).toString("hex") }
          : {}),
      });
      return stat;
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error ? error.code : null;
      observations.push({
        policyIdentity: file,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
      if (code === "ENOENT") return undefined;
      throw error;
    }
  };
  const inputs: InspectorOriginalInput[] = [];
  try {
    const gitlink = inspectorPath(authority.gitlink);
    const root = path.join(repositoryRoot, gitlink);
    assert.equal(fs.realpathSync(root), path.resolve(check.cwd), "original Gitlink physical root");
    assert.equal(
      command(root, ["rev-parse", "--show-toplevel"]).trim(),
      root,
      "fixture owns its Git root",
    );
    const link = command(repositoryRoot, ["ls-tree", "HEAD", "--", gitlink]);
    const member = link.match(/^160000 commit ([a-f0-9]{40,64})\t([^\n]+)\n$/);
    assert.ok(
      member && member[2] === gitlink,
      "source authority must be the current fixed Gitlink",
    );
    pin = member[1];
    assert.equal(
      command(root, ["rev-parse", "HEAD"]).trim(),
      pin,
      "fixture HEAD matches current Gitlink",
    );
    assert.equal(check.patterns.length, 1, "only one original recursive Vue glob is admitted");
    const pattern = check.patterns[0].match(/^([A-Za-z0-9_-]+)\/\*\*\/\*\.vue$/);
    assert.ok(pattern, "unsupported Inspector source selection");
    const prefix = `${pattern[1]}/`;
    const entries = command(root, ["ls-tree", "-rz", "--full-tree", pin, "--", pattern[1]]);
    const fullPaths: string[] = [];
    for (const entry of entries.split("\0").filter(Boolean)) {
      assert.ok(!entry.startsWith("160000 commit "), "nested source Gitlinks are unsupported");
      const item = entry.match(/^(\d+) blob ([a-f0-9]{40,64})\t([\s\S]+)$/);
      if (!item || !item[3].startsWith(prefix) || !item[3].endsWith(".vue")) continue;
      const name = inspectorPath(item[3]);
      assert.ok(
        !name.split("/").some((part) => part.startsWith(".")),
        "hidden original input is unsupported",
      );
      assert.ok(
        item[1] === "100644" || item[1] === "100755",
        "original Vue input must be a regular Git blob",
      );
      const file = path.join(root, name);
      assert.equal(
        fs.realpathSync(file),
        file,
        "original physical source must not change identity",
      );
      assert.ok(fs.lstatSync(file).isFile(), "original source must remain a regular file");
      const bytes = fs.readFileSync(file);
      const source = bytes.toString("utf8");
      assert.ok(Buffer.from(source).equals(bytes), "original source must be lossless UTF8");
      const algorithm = item[2].length === 40 ? "sha1" : "sha256";
      assert.equal(
        createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
        item[2],
        `original source differs from fixed Git object: ${name}`,
      );
      inputs.push({ path: name, source });
      observations.push({
        path: name,
        gitBlob: item[2],
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      fullPaths.push(file);
    }
    assert.ok(inputs.length > 0, "fixed Gitlink must contain original selected Vue sources");
    const parents = new Set<string>();
    for (const file of fullPaths)
      for (let parent = path.dirname(file); ; parent = path.dirname(parent)) {
        parents.add(parent);
        if (parent === path.dirname(parent)) break;
      }
    const policy = (file: string, base: string) => {
      const stat = inspect(file);
      if (!stat) return;
      assert.ok(stat.isFile(), "ignore policy must be a regular file");
      const bytes = fs.readFileSync(file);
      const text = bytes.toString("utf8");
      observations.push({
        policy: file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        text,
      });
      assert.ok(Buffer.from(text).equals(bytes), "ignore policy must be lossless UTF8");
      assertInspectorPolicyDisjoint(
        text,
        fullPaths
          .filter((file) => {
            const relative = path.relative(base, file);
            return (
              !path.isAbsolute(relative) &&
              relative !== ".." &&
              !relative.startsWith(`..${path.sep}`)
            );
          })
          .map((file) => path.relative(base, file).split(path.sep).join("/")),
      );
    };
    for (const parent of parents) {
      assert.ok(!inspect(path.join(parent, ".ignore")), "unsupported .ignore policy");
      policy(path.join(parent, ".gitignore"), parent);
      const marker = path.join(parent, ".git");
      const stat = inspect(marker);
      if (!stat) continue;
      assert.ok(stat.isDirectory() || stat.isFile(), "unsupported Git metadata identity");
      const gitdir = stat.isDirectory()
        ? marker
        : path.resolve(
            parent,
            fs.readFileSync(marker, "utf8").match(/^gitdir: ([^\r\n]+)\r?\n?$/)?.[1] ?? "",
          );
      assert.notEqual(gitdir, parent, "unsupported Git directory pointer");
      policy(path.join(gitdir, "info", "exclude"), parent);
    }
    const home = process.env.HOME;
    assert.ok(home, "home authority is required for global ignore policy");
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    assert.ok(
      path.isAbsolute(home) && path.isAbsolute(xdg),
      "absolute global ignore roots required",
    );
    // ignore0.4.33 falls back HOME→XDG even when an env-global file lacks excludesFile.
    const globals = [
      process.env.GIT_CONFIG_GLOBAL,
      path.join(home, ".gitconfig"),
      path.join(xdg, "git/config"),
      process.env.GIT_CONFIG_SYSTEM || "/etc/gitconfig",
    ];
    for (const file of new Set(globals)) {
      if (!file) continue;
      assert.ok(path.isAbsolute(file), "relative global config is unsupported");
      const stat = inspect(file);
      if (!stat) continue;
      assert.ok(stat.isFile(), "global config must be a regular file");
      const bytes = fs.readFileSync(file);
      observations.push({
        globalConfig: file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      assert.ok(
        !/excludesfile\s*=/i.test(bytes.toString("utf8")),
        "unsupported configured global ignore policy",
      );
    }
    policy(path.join(xdg, "git/ignore"), root);
    return inputs;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(directory, "original-source-authority.json"),
      JSON.stringify(
        {
          gitlink: authority.gitlink,
          pin,
          patterns: check.patterns,
          observations,
          failure,
          authority:
            "fixed authored Gitlink; positive policies proven disjoint, not a general ignore implementation",
        },
        null,
        2,
      ) + "\n",
    );
  }
}
