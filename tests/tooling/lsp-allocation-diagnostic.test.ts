import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBuildReceipt } from "../differential/build-receipt.ts";
import {
  COUNTERS,
  allocationWindows,
} from "../performance/support/allocation-diagnostic/assessment.ts";
import {
  identity,
  assertIdentity,
  smaps,
  disappeared,
} from "../performance/support/allocation-diagnostic/identity.ts";
import {
  DIAGNOSTIC_RECIPE,
  diagnosticFeatureBody,
  memoryBinding,
} from "../performance/support/allocation-diagnostic/launch.ts";
import { recordMemoryInputs } from "../performance/support/allocation-diagnostic/inputs.ts";
import {
  originalClientVector,
  originalServerVector,
} from "../performance/support/allocation-diagnostic/wire.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-memory-identity-law-"));
  const directory = path.join(root, "42");
  fs.mkdirSync(directory);
  const executable = path.join(root, "owned-executable");
  fs.writeFileSync(executable, "whole original executable bytes\n");
  fs.symlinkSync(executable, path.join(directory, "exe"));
  const writeStat = (ticks = "123", parent = "7") => {
    const fields = ["S", parent, ...Array(17).fill("0"), ticks, "0"];
    fs.writeFileSync(
      path.join(directory, "stat"),
      `42 (owned name with ) delimiter) ${fields.join(" ")}\n`,
    );
  };
  writeStat();
  fs.writeFileSync(
    path.join(directory, "smaps"),
    "1000-2000 rw-p 0000 00:00 0\nRss: 16 kB\nPss: 8 kB\n",
  );
  return { root, directory, executable, writeStat };
}

test("unset memory capture is inert and ordinary receipt rejects the diagnostic recipe", () => {
  assert.equal(process.env.VIZE_LSP_MEMORY_BINDING, undefined);
  assert.equal(memoryBinding("/nonexistent/source"), undefined);
  recordMemoryInputs(undefined as never, undefined as never, () => {
    throw new Error("unset capture walked fixture");
  });
  assert.throws(
    () => validateBuildReceipt({}, {} as never, DIAGNOSTIC_RECIPE),
    /unknown source-build recipe/,
  );
});

test("diagnostic feature custody changes only the two explicit whole opt-in clauses", () => {
  assert.equal(
    diagnosticFeatureBody(
      "crates/vize/Cargo.toml",
      Buffer.from('[features]\nprofiling = []\nlegacy = ["original"]\n'),
    ).toString(),
    '[features]\nprofiling = []\nallocation-diagnostic = ["profiling", "vize_canon/allocation-diagnostic"]\nlegacy = ["original"]\n',
  );
  assert.equal(
    diagnosticFeatureBody(
      "crates/vize_canon/Cargo.toml",
      Buffer.from('[features]\ndefault = ["native"]\nlegacy = ["original"]\n'),
    ).toString(),
    '[features]\ndefault = ["native"]\nallocation-diagnostic = []\nlegacy = ["original"]\n',
  );
  for (const changed of [
    Buffer.from('profiling = ["unknown"]\n'),
    Buffer.from("profiling = []\nprofiling = []\n"),
  ])
    assert.throws(() => diagnosticFeatureBody("crates/vize/Cargo.toml", changed));
  assert.throws(() => diagnosticFeatureBody("Cargo.toml", Buffer.from("profiling = []\n")));
});

test("actual complete stat/executable identity and smaps preserve original bytes", () => {
  const f = fixture();
  try {
    const expected = identity(42, f.root);
    assert.equal(expected.parentPid, 7);
    assert.equal(expected.startTicks, "123");
    assert.equal(expected.executable, fs.realpathSync(f.executable));
    assert.deepEqual(identity(42, f.root, expected), expected);
    assert.deepEqual(smaps(expected, f.root), fs.readFileSync(path.join(f.directory, "smaps")));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("reused PID and changed parent cannot borrow the previous process identity", () => {
  const f = fixture();
  try {
    const expected = identity(42, f.root);
    f.writeStat("124");
    assert.throws(() => smaps(expected, f.root), /PID reuse/);
    f.writeStat("123", "8");
    assert.throws(() => assertIdentity(identity(42, f.root), expected), /PID reuse/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("changed executable content and executable replacement are hard refusals", () => {
  const f = fixture();
  try {
    const expected = identity(42, f.root);
    fs.writeFileSync(f.executable, "different complete executable bytes\n");
    assert.throws(() => smaps(expected, f.root));
    fs.unlinkSync(path.join(f.directory, "exe"));
    fs.symlinkSync(process.execPath, path.join(f.directory, "exe"));
    assert.throws(() => smaps(expected, f.root));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("missing smaps stays explicit disappearance; only ENOENT and ESRCH qualify that label", () => {
  const f = fixture();
  try {
    const expected = identity(42, f.root);
    fs.unlinkSync(path.join(f.directory, "smaps"));
    assert.throws(
      () => smaps(expected, f.root),
      (error: unknown) => disappeared(error),
    );
    for (const code of ["ENOENT", "ESRCH"])
      assert(disappeared(Object.assign(new Error(code), { code })));
    for (const code of ["EACCES", "EPERM", "EIO"])
      assert(!disappeared(Object.assign(new Error(code), { code })));
    assert(!disappeared(new Error("PID mismatch")));
    assert(!disappeared({ code: "ENOENT" }));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

function packets() {
  const counters = (prefix = "", value = 0) =>
    COUNTERS.map((field) => `${prefix}${field}=${value}`).join(" ");
  const session = (event: string, value: number) =>
    `vize_lsp_allocation_session event=${event} pid=42 allocator=existing_ProfilingAllocator_MiMalloc diagnostic_only=true acceptance_credit=none ${counters("", value)}`;
  const window = `vize_editor_allocation: event="window" pid=42 phase="alias_build" id=48 completed=true phase_size=200 allocation_window_size=96 allocation_field_size=104 scope="global_overlapping_window_with_observer_overhead" diagnostic_only=true acceptance_credit="none" ${counters("before_")} ${counters("after_", 11)}`;
  const storage = `vize_editor_allocation: event="native_fact_storage" pid=42 diagnostic_only=true acceptance_credit="none" allocator_class="unobserved" arc_and_path_allocations="not_walked" ${["facts_len", "facts_capacity", "stamp_size", "map_len", "map_usable_capacity", "bucket_size", "old_vec_bucket_size", "map_pair_size", "old_map_pair_size", "empty_buckets", "singleton_buckets", "collision_buckets", "collision_indices", "collision_capacity", "index_size", "old_singleton_probe_capacity"].map((key) => `${key}=1`).join(" ")}`;
  return [session("begin", 0), window, storage, session("end", 17)].join("\n");
}

test("whole diagnostic packets retain all twelve counter deltas and no causal or acceptance claim", () => {
  const result = allocationWindows(packets(), 42);
  assert.equal(Object.keys(result.totals).length, 12);
  assert.equal(result.totals.realloc_old_bytes.delta, "17");
  assert.equal(result.windows, 1);
  assert.equal(result.storageReports, 1);
  assert.equal(result.allocatorCoverage, "not_established");
  assert.equal(result.lifetimeAttribution, "none");
  assert.equal(result.callsiteAttribution, "none");
  assert.equal(result.acceptanceCredit, "none");
});

test("missing counters, resets, wrong PID, missing owner-end and missing storage remain refusals", () => {
  const original = packets();
  for (const changed of [
    original.replace("after_realloc_new_bytes=11", "after_realloc_new_bytes=missing"),
    original.replace("before_alloc_calls=0", "before_alloc_calls=12"),
    original.replace("pid=42", "pid=41"),
    original.split("\n").slice(0, -1).join("\n"),
    original
      .split("\n")
      .filter((line) => !line.includes("native_fact_storage"))
      .join("\n"),
    original.replace("acceptance_credit=none", "acceptance_credit=full"),
    original.replace("phase_size=200", "phase_size=0"),
  ])
    assert.throws(() => allocationWindows(changed, 42));
});

test("every window stays within its actual owner totals and storage cannot claim acceptance", () => {
  const original = packets();
  for (const changed of [
    original.replace("after_alloc_calls=11", "after_alloc_calls=18"),
    original.replace(
      "acceptance_credit=none alloc_calls=0",
      "acceptance_credit=none alloc_calls=1",
    ),
    original.replace(
      'diagnostic_only=true acceptance_credit="none" allocator_class=',
      "allocator_class=",
    ),
    original.replace(
      'acceptance_credit="none" allocator_class=',
      'acceptance_credit="full" allocator_class=',
    ),
    original.replace(
      'diagnostic_only=true acceptance_credit="none" allocator_class=',
      'diagnostic_only=false acceptance_credit="none" allocator_class=',
    ),
  ])
    assert.throws(() => allocationWindows(changed, 42));
});

test("only one actual initialize processId is normalized; raw query and diagnostic vectors stay exact", () => {
  const messages = (root: string, pid: number) => [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: pid, rootUri: `file://${root}` },
    },
    {
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: `file://${root}/a.vue`, version: 2 },
        contentChanges: [{ text: "whole original source" }],
      },
    },
    { jsonrpc: "2.0", id: 2, method: "shutdown", params: null },
  ];
  const a = messages("/first", 7),
    b = messages("/second", 8);
  const before = structuredClone(a);
  assert.deepEqual(
    originalClientVector(a, "/first", { pid: 42, parentPid: 7 }),
    originalClientVector(b, "/second", { pid: 43, parentPid: 8 }),
  );
  assert.deepEqual(a, before);
  const altered = (edit: (value: any[]) => void) => {
    const value = structuredClone(a);
    edit(value);
    return value;
  };
  for (const changed of [
    altered((value) => {
      value[0].params.processId = 8;
    }),
    altered((value) => {
      value[0].params.processId = "7";
    }),
    altered((value) => {
      delete value[0].params.processId;
    }),
    altered((value) => {
      value.push(structuredClone(value[0]));
    }),
    altered((value) => {
      value.shift();
    }),
    altered((value) => {
      value[1].params.processId = 7;
    }),
    altered((value) => {
      value[0].params.parentPid = 7;
    }),
    altered((value) => {
      value[1].method = "textDocument/completion";
    }),
  ])
    assert.throws(() => originalClientVector(changed, "/first", { pid: 42, parentPid: 7 }));
  for (const edit of [
    (value: any[]) => {
      value[0].id = 99;
    },
    (value: any[]) => {
      value.reverse();
    },
    (value: any[]) => {
      value[1].params.contentChanges[0].text = "changed original source";
    },
  ])
    assert.notDeepEqual(
      originalClientVector(altered(edit), "/first", { pid: 42, parentPid: 7 }),
      originalClientVector(a, "/first", { pid: 42, parentPid: 7 }),
    );
  const diagnostic = [
    {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///first/a.vue",
        diagnostics: [{ message: "whole native error", code: 2322 }],
      },
    },
  ];
  assert.notDeepEqual(
    originalServerVector(diagnostic, "/first"),
    originalServerVector(
      [{ ...diagnostic[0], params: { ...diagnostic[0].params, diagnostics: [] } }],
      "/first",
    ),
  );
});
