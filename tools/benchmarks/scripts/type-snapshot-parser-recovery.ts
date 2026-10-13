import { stripVTControlCharacters } from "node:util";

type ProcessResult = { stdout: string; stderr: string; status: number | null };

/** Malformed, untimed parity fixtures require the semantic recovery path. */
export function normalizeParserRecovery<T extends ProcessResult>(
  result: T,
  expected: boolean,
  phase: string,
): T {
  if (!expected || !["parity", "parity-profile"].includes(phase) || result.status !== 1)
    return result;
  const stderr = stripVTControlCharacters(result.stderr).trim();
  const notice =
    "warning: corsa: Corsa CLI fast path unavailable; degraded to the slower project-session API (check failure). Type checking continues on a slower path.";
  if (stderr !== notice && stderr !== `${notice}\nerror handling method 'exit': EOF`) return result;
  const report = JSON.parse(result.stdout) as {
    files?: { diagnostics?: unknown[] }[];
  };
  if (
    !report.files?.some((file) =>
      file.diagnostics?.some(
        (diagnostic) =>
          typeof diagnostic === "string" && /^error:\d+:\d+ \[TS1[0-4]\d{2}\]/u.test(diagnostic),
      ),
    )
  )
    return result;
  // The caller has already retained raw stderr. Full report normalization and
  // exact base/head, one/two-server parity remain mandatory after this adapter.
  return { ...result, stderr: "" };
}
