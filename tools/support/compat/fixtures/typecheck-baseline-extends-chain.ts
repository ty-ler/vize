import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stripJsonc } from "./typecheck-baseline-jsonc.ts";

export type TsconfigJson = Readonly<Record<string, unknown>>;

export interface TsconfigLink {
  readonly config: TsconfigJson;
  readonly dir: string;
}

export type ResolveExtends = (current: string, specifier: string) => string | null | undefined;

export function loadTsconfigExtendsChain(
  sourceConfigPath: string,
  resolveExtends: ResolveExtends,
): TsconfigLink[] {
  const chain: TsconfigLink[] = [];
  appendExtendsChain(chain, new Set(), resolve(sourceConfigPath), resolveExtends);
  return chain;
}

function appendExtendsChain(
  chain: TsconfigLink[],
  seen: Set<string>,
  current: string,
  resolveExtends: ResolveExtends,
): void {
  if (seen.has(current)) return;
  seen.add(current);
  const config = parseTsconfig(current);
  if (config == null) return;
  chain.push({ config, dir: dirname(current) });
  const resolved = extendsSpecifiers(config.extends)
    .map((specifier) => resolveExtends(current, specifier))
    .filter((entry): entry is string => entry != null);
  for (const next of resolved.reverse()) {
    appendExtendsChain(chain, seen, next, resolveExtends);
  }
}

function parseTsconfig(configPath: string): TsconfigJson | null {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(readFileSync(configPath, "utf8")));
    return parsed != null && typeof parsed === "object" ? (parsed as TsconfigJson) : null;
  } catch {
    return null;
  }
}

function extendsSpecifiers(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
