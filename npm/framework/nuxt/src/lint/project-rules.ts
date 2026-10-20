/**
 * Project lint rules layered under the generated Nuxt oxlint config.
 *
 * The artifact keeps `settings.vize.preset` at `incremental` so Nuxt-only rules
 * stay enabled. A preset from the shared project config is therefore expanded into
 * explicit rule entries instead of replacing that runtime preset.
 */
import type { NuxtLintSeverity } from "@vizejs/nuxt-lint-config";
import type { VizeRuleConfigPreset } from "oxlint-plugin-vize";
import * as fs from "node:fs";
import * as path from "node:path";
import { importConfigModule } from "../../../../cli/src/config/module-runtime.mjs";
import {
  VITE_CONFIG_FILE_NAMES,
  resolveViteConfigSource,
} from "../../../../cli/src/config/vite-runtime.mjs";

export type ProjectLintRules = Record<string, NuxtLintSeverity>;

export interface ProjectLintRuleSets {
  vize?: ProjectLintRules;
  oxlint?: ProjectLintRules;
}

export type ProjectPresetLoader = (
  preset: VizeRuleConfigPreset,
  typeAware: boolean,
) => Promise<ProjectLintRules>;

const CONFIG_PRESETS = [
  "happy-path",
  "opinionated",
  "essential",
  "incremental",
  "ecosystem",
  "nuxt",
] as const;

const RETIRED_CONFIG = /^vize\.config\.(?:pkl|[cm]?[jt]s|json)$/;
const CONFIG_MIGRATION =
  "vize.config.* is no longer supported; move Vue settings to vue: in vite.config.* and TypeScript settings to tsconfig.json";

type ConfigPreset = (typeof CONFIG_PRESETS)[number];

interface ProjectLinterConfig {
  preset?: ConfigPreset;
  typeAware: boolean;
  rules: ProjectLintRules;
}

export async function readProjectLintRules(
  rootDir: string,
  loadPreset: ProjectPresetLoader = loadPresetRules,
): Promise<ProjectLintRules | undefined> {
  return (await readProjectLintRuleSets(rootDir, loadPreset)).vize;
}

export async function readProjectLintRuleSets(
  rootDir: string,
  loadPreset: ProjectPresetLoader = loadPresetRules,
): Promise<ProjectLintRuleSets> {
  const project = await readProjectConfig(rootDir);
  const linter = project.linter;
  const oxlint = explicitOxlintRules(project.oxlint);
  let vize: ProjectLintRules | undefined;
  if (linter) {
    const presetRules =
      linter.preset && linter.preset !== "incremental"
        ? await loadPreset(linter.preset, linter.typeAware)
        : {};
    const rules = { ...presetRules, ...linter.rules };
    if (Object.keys(rules).length > 0) vize = rules;
  }
  return {
    ...(vize ? { vize } : {}),
    ...(Object.keys(oxlint).length > 0 ? { oxlint } : {}),
  };
}

interface ProjectConfig {
  linter?: ProjectLinterConfig;
  oxlint?: unknown;
}

async function readProjectConfig(rootDir: string): Promise<ProjectConfig> {
  const parsed = await loadProjectViteConfigSource(rootDir);
  if (!parsed) return {};
  const rawLinter =
    parsed.vue &&
    typeof parsed.vue === "object" &&
    "linter" in parsed.vue &&
    parsed.vue.linter &&
    typeof parsed.vue.linter === "object"
      ? (parsed.vue.linter as { preset?: unknown; rules?: unknown; typeAware?: unknown })
      : undefined;
  return {
    linter: rawLinter
      ? {
          preset: isConfigPreset(rawLinter.preset) ? rawLinter.preset : undefined,
          typeAware: rawLinter.typeAware === true,
          rules: explicitRules(rawLinter.rules),
        }
      : undefined,
    oxlint: parsed.lint,
  };
}

async function loadProjectViteConfigSource(
  rootDir: string,
): Promise<Record<string, unknown> | null> {
  let directory = path.resolve(rootDir);
  while (true) {
    for (const name of VITE_CONFIG_FILE_NAMES) {
      const filePath = path.join(directory, name);
      if (!fs.existsSync(filePath)) continue;
      const module = await importConfigModule(filePath);
      if (module === null) throw new Error("Unable to load Vite configuration at " + filePath);
      return resolveViteConfigSource(module.default ?? module, {
        command: "lint",
        mode: "development",
      });
    }
    if (
      fs.existsSync(directory) &&
      fs.readdirSync(directory).some((name) => RETIRED_CONFIG.test(name))
    ) {
      throw new Error(CONFIG_MIGRATION);
    }
    if (
      ["package.json", "tsconfig.json", "jsconfig.json"].some((name) =>
        fs.existsSync(path.join(directory, name)),
      )
    ) {
      return null;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function explicitOxlintRules(value: unknown): ProjectLintRules {
  if (!value || typeof value !== "object") return {};
  const rules = "rules" in value ? (value as { rules?: unknown }).rules : undefined;
  if (!rules || typeof rules !== "object") return {};
  const result: ProjectLintRules = {};
  for (const [id, severity] of Object.entries(rules)) {
    if (isSeverity(severity)) result[id] = severity;
  }
  return result;
}

async function loadPresetRules(
  preset: VizeRuleConfigPreset,
  typeAware: boolean,
): Promise<ProjectLintRules> {
  const { createVizeRuleConfig } = await import("oxlint-plugin-vize");
  const generated = createVizeRuleConfig({ includeTypeAware: typeAware, preset });
  const rules: ProjectLintRules = {};
  for (const [id, severity] of Object.entries(generated)) {
    if (!isSeverity(severity)) continue;
    const bare = id.startsWith("vize/") ? id.slice("vize/".length) : id;
    if (bare.length > 0) rules[bare] = severity;
  }
  return rules;
}

function explicitRules(value: unknown): ProjectLintRules {
  if (!value || typeof value !== "object") return {};
  const rules: ProjectLintRules = {};
  for (const [id, severity] of Object.entries(value)) {
    if (!isSeverity(severity)) continue;
    const bare = id.startsWith("vize/") ? id.slice("vize/".length) : id;
    if (bare.length > 0) rules[bare] = severity;
  }
  return rules;
}

function isConfigPreset(value: unknown): value is ConfigPreset {
  return typeof value === "string" && (CONFIG_PRESETS as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is NuxtLintSeverity {
  return value === "off" || value === "warn" || value === "error";
}
