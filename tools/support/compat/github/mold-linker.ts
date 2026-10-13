import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";

const original = "wild-linker/action@0bbbfa5df4380cab8e63cb8505a1ce65e1d10203";
const recovery = "./.github/actions/setup-wild-http-recovery";
const mold = /^\.\/(?:head\/|harness\/)?\.github\/actions\/setup-mold$/;

export function isMoldLinkerMigration(before: string, after: string): boolean {
  let replacements = 0;
  function normalize(value: unknown, previous: boolean): unknown {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, previous));
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalize(entry, previous)]),
    );
    if (previous && (result.uses === original || result.uses === recovery)) {
      if (result.with && !isDeepStrictEqual(result.with, { "wild-version": "0.9.0" }))
        return result;
      replacements++;
      result.uses = "approved-native-linker";
      delete result.with;
      if (typeof result.name === "string")
        result.name = result.name
          .replace("Setup Wild linker recovery (SSR-Pug)", "Setup mold linker (SSR-Pug)")
          .replace("Setup Wild linker", "Setup mold linker");
    } else if (!previous && typeof result.uses === "string" && mold.test(result.uses)) {
      result.uses = "approved-native-linker";
    }
    return result;
  }
  const left = normalize(parse(before), true);
  const right = normalize(parse(after), false);
  return replacements > 0 && isDeepStrictEqual(left, right);
}
