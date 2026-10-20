import type {
  PatinaLintResult,
  PatinaRuleMeta,
  PatinaRuleOptions,
  PatinaSettings,
} from "./model.js";
import { loadBinding } from "./native.js";
import { getActivePreset } from "./settings.js";

export function lintPatina(
  source: string,
  filename: string,
  settings: PatinaSettings,
  enabledRules?: readonly string[],
  ruleOptions?: PatinaRuleOptions,
): PatinaLintResult {
  const { ruleOptions: cliRuleOptions, ...directRuleOptions } = ruleOptions ?? {};
  return loadBinding().lintPatinaSfc(source, {
    filename,
    locale: settings.locale,
    helpLevel: settings.helpLevel,
    preset: getActivePreset(settings),
    enabledRules: enabledRules ? [...enabledRules] : undefined,
    typeAware: settings.typeAware,
    corsaPath: settings.corsaPath,
    ruleOptionsJson: cliRuleOptions ? JSON.stringify(cliRuleOptions) : undefined,
    ...directRuleOptions,
  });
}

export function getPatinaRules(): PatinaRuleMeta[] {
  return loadBinding().getPatinaRules();
}
