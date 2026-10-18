export const gitReaderReviewedSource = "7e5630229d0d34c8b25e423544bad275fb67b925";
export const gitReaderOriginalSource = "5459e40a23ca7e647ace8ebd20e1fe00c9294437";
export const gitReaderHarnessPairs: ReadonlyArray<readonly [string, string | null, string | null]> =
  [
    [
      "tests/performance/support/warm-type-backed-path-host.ts",
      "b73e46382f99176d54dfa9b5945f6126eefedd6ecfb9cbd4c733151c3e2c6c30",
      "99f84b671f904a819b5e6e1e319fd97db2ae537b7ba1c773013b1e0e87cd7940",
    ],
    [
      "tests/tooling/warm-type-backed-git-body-authority.test.ts",
      null,
      "d54d8a937f10667470c78e1c0174ff10797c6929c059f98323fdc6962e078f90",
    ],
    [
      "docs/davinci/decisions/2026-10-12-3952-raw-git-body-authority.md",
      null,
      "2cbe0f10dec99c16a44ccd07fd3f70debc5a2a5ee520f1791164403da9c5de54",
    ],
    [
      "tests/performance/support/warm-type-backed-path-host-manifest.json",
      "36256d2672412efe1681fab3137fab4f641622920360ea690a98a463a7325805",
      "36256d2672412efe1681fab3137fab4f641622920360ea690a98a463a7325805",
    ],
    [
      "tests/tooling/warm-type-backed-path-host.test.ts",
      "3dfad726a861009ea8b906752797f6be8654adbba5955dcb649cb0e48d455d48",
      "3dfad726a861009ea8b906752797f6be8654adbba5955dcb649cb0e48d455d48",
    ],
    [
      "tests/tooling/warm-type-backed-default-migration-host.test.ts",
      "86ce5a8bcbb25c298e59d211910b6aeca3da3e280f9a2109ce0daee6ace2ca0c",
      "86ce5a8bcbb25c298e59d211910b6aeca3da3e280f9a2109ce0daee6ace2ca0c",
    ],
  ];

/** Admit the reviewed reader and its laws only after complete source checks. */
export function qualifyGitReaderHarness(
  changed: readonly string[],
  alreadyQualified: ReadonlySet<string>,
  digest: (side: "before" | "after", file: string) => string | null,
) {
  const required = gitReaderHarnessPairs.slice(0, 3).map(([file]) => file);
  const finite = new Set(required);
  if (
    new Set(changed).size !== changed.length ||
    required.some((file) => !changed.includes(file)) ||
    changed.some((file) => !alreadyQualified.has(file) && !finite.has(file))
  )
    return null;
  for (const [file, before, after] of gitReaderHarnessPairs)
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  return {
    authority: "complete-reviewed-raw-git-reader-harness",
    reviewedReaderSource: gitReaderReviewedSource,
    completeBodyPairs: gitReaderHarnessPairs.length,
    files: required,
  };
}
