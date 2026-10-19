import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isolatedTsconfigOverlayPath } from "./typecheck-baseline-outside-paths.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export interface ToolMatrixProject {
  readonly fixturePath?: unknown;
  readonly tsconfig?: unknown;
  readonly vueGlobs: readonly string[];
  readonly expectedVueFileCount?: number;
  readonly typecheckPerformance?: {
    readonly corpusGlobs?: readonly string[];
    readonly baseline?: { readonly tsconfig?: unknown };
  };
}

export type ToolName = "compiler" | "linter" | "typechecker" | "formatter";

export function typecheckCorpusGlobs(project: ToolMatrixProject): readonly string[] {
  return project.typecheckPerformance?.corpusGlobs ?? project.vueGlobs;
}

export function typecheckSourceTsconfig(project: ToolMatrixProject): string | null {
  const baseline = project.typecheckPerformance?.baseline?.tsconfig;
  if (typeof baseline === "string") return baseline;
  return typeof project.tsconfig === "string" ? project.tsconfig : null;
}

export function typecheckTsconfigPath(project: ToolMatrixProject): string | null {
  // vue-tsc measures `baseline.tsconfig` when it is set. Elk's root config is
  // a solution (`files: []` + `references`); using it would compare a different
  // program than the baseline (#4461).
  const source = typecheckSourceTsconfig(project);
  if (source == null) return null;
  const overlayRel = isolatedTsconfigOverlayPath(source);
  const overlayAbs =
    typeof project.fixturePath === "string"
      ? resolve(repoRoot, project.fixturePath, overlayRel)
      : resolve(overlayRel);
  return existsSync(overlayAbs) ? overlayRel : source;
}

export function toolArgs(
  project: ToolMatrixProject,
  tool: string,
  compilerOutputDir: string,
  options: { readonly typecheckTsconfigPath?: string | null } = {},
): string[] {
  if (tool === "compiler") {
    return [
      "build",
      ...project.vueGlobs,
      "--format",
      "json",
      "--output",
      compilerOutputDir,
      "--template-syntax",
      "quirks",
      "--continue-on-error",
      "--no-config",
    ];
  }
  if (tool === "linter") {
    return [
      "lint",
      ...project.vueGlobs,
      "--format",
      "json",
      "--preset",
      "ecosystem",
      "--no-config",
    ];
  }
  if (tool === "typechecker") {
    // One `--tsconfig` cannot answer for sibling apps that `vueGlobs` still
    // cover for compiler/linter/formatter. Narrow the typecheck corpus to the
    // files that config owns, or vue-tsc's baseline inherits the same
    // unresolvable aliases and the comparison reports fake FNs (#4454).
    const generatedScripts =
      options.typecheckTsconfigPath != null &&
      typecheckSourceTsconfig(project) == null &&
      project.expectedVueFileCount === 0;
    const args = [
      "check",
      ...(generatedScripts ? [] : typecheckCorpusGlobs(project)),
      "--format",
      "json",
      "--no-config",
    ];
    const tsconfig = options.typecheckTsconfigPath ?? typecheckTsconfigPath(project);
    if (tsconfig != null) args.push("--tsconfig", tsconfig);
    return args;
  }
  return ["fmt", ...project.vueGlobs, "--check", "--no-config"];
}

export function displayCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@*-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
