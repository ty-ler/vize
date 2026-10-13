import assert from "node:assert/strict";
import { processCount } from "./qualification-parallelism.ts";

export type HostSlice = { index: number; start: number; end: number };
export type HostReport = {
  diagnostics: Array<{ filename?: string }>;
  number_of_files: number;
  number_of_rules: number;
  threads_count: number;
  start_time: number;
};

// One whole-project run unless CI selects a fixed count for the reference mode.
export function hostReferenceSliceCount(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return processCount(environment, "VIZE_N8N_HOST_REFERENCE_SLICES", 1, { min: 1, max: 16 });
}

const bytes = (value: string) => Buffer.from(value, "utf8");
const componentOrder = (left: string, right: string) => {
  const a = left.split("/"),
    b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const order = Buffer.compare(bytes(a[index]), bytes(b[index]));
    if (order !== 0) return order;
  }
  return a.length - b.length;
};

// A boundary is safe when the files before it are the same set in byte order
// (the inventory order) and in directory-walk order. Oxlint then reports the
// slices in the same relative order as one whole-project run, whichever of
// the two orders it uses.
export function orderSafeBoundaries(files: readonly string[]): number[] {
  for (let index = 1; index < files.length; index++)
    assert.ok(Buffer.compare(bytes(files[index - 1]), bytes(files[index])) < 0, "byte order");
  const walk = [...files].sort(componentOrder);
  const rank = new Map(walk.map((file, index) => [file, index]));
  const safe = [];
  let highest = -1;
  for (let index = 0; index < files.length - 1; index++) {
    highest = Math.max(highest, rank.get(files[index])!);
    if (highest === index) safe.push(index + 1);
  }
  return safe;
}

// Fixed contiguous slices of the ordered inventory, cut only at safe
// boundaries nearest to equal sizes. One slice is the whole-project run.
export function referenceSlices(files: readonly string[], count: number): HostSlice[] {
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= files.length);
  const safe = orderSafeBoundaries(files);
  const cuts: number[] = [];
  for (let index = 1; index < count; index++) {
    const ideal = Math.ceil((index * files.length) / count);
    const candidates = safe.filter((cut) => cut > (cuts.at(-1) ?? 0));
    assert.ok(candidates.length > 0, "not enough order-safe slice boundaries");
    cuts.push(
      candidates.reduce((best, cut) =>
        Math.abs(cut - ideal) < Math.abs(best - ideal) ? cut : best,
      ),
    );
  }
  const bounds = [0, ...cuts, files.length];
  return bounds.slice(0, -1).map((start, index) => ({ index, start, end: bounds[index + 1] }));
}

// Join the slice reports into the report one whole-project run returns:
// diagnostics in slice order, file counts summed, identical rule and thread
// counts. Every slice reports exactly its own files.
export function mergeSliceReports(
  files: readonly string[],
  slices: readonly HostSlice[],
  reports: readonly HostReport[],
): HostReport {
  assert.equal(reports.length, slices.length);
  slices.forEach(({ index, start, end }, position) => {
    assert.equal(index, position);
    assert.equal(start, position === 0 ? 0 : slices[position - 1].end, "contiguous slices");
    assert.ok(start < end, "non-empty slices");
  });
  assert.equal(slices.at(-1)?.end, files.length, "slices cover the ordered inventory once");
  for (const [index, report] of reports.entries()) {
    const { start, end } = slices[index];
    const owned = new Set(files.slice(start, end));
    assert.ok(Array.isArray(report.diagnostics));
    assert.equal(report.number_of_files, end - start, `slice ${index}: whole slice linted`);
    for (const packet of report.diagnostics)
      assert.ok(owned.has(packet.filename ?? ""), `slice ${index}: foreign ${packet.filename}`);
    assert.equal(report.number_of_rules, reports[0].number_of_rules);
    assert.equal(report.threads_count, reports[0].threads_count);
    assert.equal(typeof report.start_time, "number");
  }
  return {
    diagnostics: reports.flatMap((report) => report.diagnostics),
    number_of_files: reports.reduce((sum, report) => sum + report.number_of_files, 0),
    number_of_rules: reports[0].number_of_rules,
    threads_count: reports[0].threads_count,
    start_time: Math.min(...reports.map((report) => report.start_time)),
  };
}
