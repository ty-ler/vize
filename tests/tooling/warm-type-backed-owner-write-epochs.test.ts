import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NativeActorLifecycle } from "../performance/support/warm-type-backed-owner-lifecycle.ts";
import { ElfHandles } from "../performance/support/warm-type-backed-owner-live-process.ts";
import { authenticateWriteEpochs } from "../performance/support/warm-type-backed-owner-write-epochs.ts";
import { retireKernelObserver } from "../performance/support/warm-type-backed-owner-retirement.ts";
import { syscallWrites } from "../performance/support/warm-type-backed-owner-syscalls.ts";
import {
  actor,
  parentImage,
  otherImage,
  selectedImage,
} from "./support/warm-type-backed-owner-lifecycle-fixture.ts";

function fixture() {
  const parent = actor(10);
  parent.descriptors.push({ fd: 3, target: "pipe:[200]" }, { fd: 4, target: "socket:[900]" });
  const native = actor(20, 20, selectedImage, 10);
  native.descriptors.push({ fd: 3, target: "socket:[901]" });
  native.process.sockets.push({ pipe: "/tmp/tsgo-api-exact", inode: "901" });
  const live = new Map([
    [10, parent],
    [20, native],
  ]);
  const lifecycle = new NativeActorLifecycle(
    10,
    selectedImage,
    (thread) => {
      const value = live.get(thread);
      assert.ok(value);
      return structuredClone(value);
    },
    () => {},
  );
  lifecycle.initial(parent);
  lifecycle.line("10 1.000000 fork() = 20");
  const lines: string[] = [];
  const write = (line: string) => {
    lifecycle.line(line);
    lines.push(line);
  };
  const qualify = () =>
    authenticateWriteEpochs(
      syscallWrites(lines.join("\n")),
      lifecycle,
      selectedImage,
      lifecycle.nativeWitnesses(),
      [parent.process],
    );
  return { live, lifecycle, native, parent, write, qualify };
}

await test("every original pipe/socket write joins its exact whole live actor and numbered FD", () => {
  const f = fixture();
  f.write('10 1.000001 write(3<pipe:[200]>, "a", 1) = 1');
  f.write('20 1.000002 write(1<pipe:[201]>, "b", 1) = 1');
  f.write('10 1.000003 write(4<UNIX-STREAM:[900->901]>, "c", 1) = 1');
  f.write('20 1.000004 write(3<UNIX-STREAM:[901->900]>, "d", 1) = 1');
  const result = f.qualify();
  assert.equal(result.length, 4);
  assert.deepEqual(
    result.map(({ fd }) => fd),
    [3, 1, 4, 3],
  );
  f.lifecycle.events.pop();
  assert.throws(() => f.qualify(), /exact whole lifecycle/u);
});

await test("a later actual native thread needs its own complete current epoch and pipe witness", () => {
  const f = fixture();
  const worker = actor(21, 20, selectedImage, 10);
  worker.descriptors = structuredClone(f.native.descriptors);
  worker.process = { ...structuredClone(f.native.process), threads: [20, 21] };
  f.native.process.threads = [20, 21];
  f.live.set(21, worker);
  f.lifecycle.line("20 1.000001 clone3({flags=CLONE_VM|CLONE_THREAD|CLONE_SIGHAND}, 88) = 21");
  f.write('21 1.000002 write(1<pipe:[201]>, "actual", 6) = 6');
  const witnesses = f.lifecycle.nativeWitnesses();
  assert.ok(witnesses.some(({ threads }) => !threads.includes(21)));
  assert.ok(witnesses.some(({ threads }) => threads.includes(21)));
  assert.equal(f.qualify().length, 1);
  const qualify = (current: typeof witnesses) =>
    authenticateWriteEpochs(
      syscallWrites('21 1.000002 write(1<pipe:[201]>, "actual", 6) = 6'),
      f.lifecycle,
      selectedImage,
      current,
      [f.parent.process],
    );
  assert.throws(() => qualify(witnesses.filter(({ threads }) => !threads.includes(21))));
  for (const field of [
    "pid",
    "ppid",
    "birthTicks",
    "executable",
    "executableSHA256",
    "stdin",
    "stdout",
  ] as const) {
    const drift = structuredClone(witnesses);
    for (const candidate of drift)
      if (candidate.threads.includes(21)) {
        if (typeof candidate[field] === "number")
          Object.assign(candidate, { [field]: Number(candidate[field]) + 1 });
        else Object.assign(candidate, { [field]: `${candidate[field]}.foreign` });
      }
    assert.throws(() => qualify(drift), field);
  }
});

await test("SDK-to-foreign-to-SDK execution cannot lend historical native TIDs/pipes to foreign bytes", () => {
  const f = fixture();
  f.write('20 1.000001 write(1<pipe:[201]>, "a", 1) = 1');
  const foreign = actor(20, 20, otherImage, 10);
  f.live.set(20, foreign);
  f.lifecycle.line("20 1.000002 execve(0x123, 0x456, 0x789) = 0");
  f.write('20 1.000003 write(1<pipe:[201]>, "b", 1) = 1');
  f.live.set(20, f.native);
  f.lifecycle.line("20 1.000004 execve(0x123, 0x456, 0x789) = 0");
  assert.ok(f.lifecycle.nativeWitnesses().length > 1);
  assert.throws(() => f.qualify(), /current actual process epoch/u);
});

await test("actual reused FD, copied ELF, foreign pipe writer and changed client image refuse", () => {
  const changedFD = fixture();
  changedFD.native.descriptors.find(({ fd }) => fd === 1)!.target = "pipe:[999]";
  changedFD.write('20 1.000001 write(1<pipe:[201]>, "a", 1) = 1');
  assert.throws(() => changedFD.qualify(), /original write FD/u);
  const copied = fixture();
  copied.native.image = { ...selectedImage, inode: "foreign-copy" };
  copied.lifecycle.line("20 1.000001 execve(0x123, 0x456, 0x789) = 0");
  copied.write('20 1.000002 write(1<pipe:[201]>, "a", 1) = 1');
  assert.throws(() => copied.qualify());
  const foreign = fixture();
  const writer = actor(30, 30, otherImage, 10);
  writer.descriptors.find(({ fd }) => fd === 1)!.target = "pipe:[201]";
  foreign.live.set(30, writer);
  foreign.lifecycle.line("10 1.000001 fork() = 30");
  foreign.write('30 1.000002 write(1<pipe:[201]>, "a", 1) = 1');
  assert.throws(() => foreign.qualify(), /foreign writer/u);
  const client = fixture();
  const replacement = structuredClone(client.parent);
  replacement.image = { ...parentImage, inode: "copied-parent" };
  client.live.set(10, replacement);
  client.lifecycle.line("10 1.000001 execve(0x123, 0x456, 0x789) = 0");
  client.write('10 1.000002 write(3<pipe:[200]>, "a", 1) = 1');
  assert.throws(() => client.qualify(), /client ELF epoch/u);
});

await test("unfinished writes retain both original actor epochs and refuse intervening executable changes", () => {
  const normal = fixture();
  normal.write('20 1.000001 write(1<pipe:[201]>, "a", 1 <unfinished ...>');
  normal.write("20 1.000002 <... write resumed>) = 1");
  assert.equal(normal.qualify().length, 1);
  const changed = fixture();
  changed.write('20 1.000001 write(1<pipe:[201]>, "a", 1 <unfinished ...>');
  changed.live.set(20, actor(20, 20, otherImage, 10));
  changed.lifecycle.line("20 1.000002 execve(0x123, 0x456, 0x789) = 0");
  changed.write("20 1.000003 <... write resumed>) = 1");
  assert.throws(() => changed.qualify(), /write executable epoch/u);
});

await test("equal synthetic stat metadata cannot conceal real complete executable byte mutation", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owner-fresh-elf-"));
  const file = path.join(directory, "actual-elf");
  const bytes = Buffer.concat([Buffer.from([127, 69, 76, 70]), Buffer.alloc(256, 7)]);
  fs.writeFileSync(file, bytes);
  const metadata = fs.statSync(file, { bigint: true });
  t.mock.method(fs, "fstatSync", () => metadata);
  const handles = new ElfHandles();
  try {
    handles.read(file);
    bytes[128] = 8;
    fs.writeFileSync(file, bytes);
    assert.throws(() => handles.read(file), /fresh complete executable bytes/u);
  } finally {
    handles.close();
    fs.rmSync(directory, { recursive: true });
  }
});

await test("interrupt/closed/proof/stream failures still reap and close while retaining the first refusal", async () => {
  for (const stage of ["interrupt", "closed", "proof", "stream", "close"]) {
    const events: string[] = [];
    const first = new Error(stage);
    const call = (name: string) => () => {
      events.push(name);
      if (name === stage) throw first;
    };
    await assert.rejects(
      retireKernelObserver(
        call("interrupt"),
        stage === "closed" ? Promise.reject(first) : Promise.resolve({ code: 0 }),
        call("proof"),
        call("stream"),
        call("close"),
      ),
      (error) => error === first,
    );
    assert.ok(events.includes("proof"));
    assert.equal(events.at(-1), "close");
  }
  const original = new Error("original whole-byte refusal");
  let closed = false;
  await assert.rejects(
    retireKernelObserver(
      () => {
        throw new Error("kill failed");
      },
      Promise.resolve({ code: 0 }),
      () => {},
      () => {
        throw original;
      },
      () => {
        closed = true;
      },
    ),
    (error) => error === original,
  );
  assert.equal(closed, true);
});

await test("coalesced exec records cannot borrow the final SDK image for an unwitnessed epoch", () => {
  for (const call of ["execve(0x123, 0x456, 0x789)", "execveat(3, 0x123, 0x456, 0x789, 0)"]) {
    const f = fixture();
    const chunk = [
      `20 1.000001 ${call} = 0`,
      '20 1.000002 write(1<pipe:[201]>, "foreign", 7) = 7',
      `20 1.000003 ${call} = 0`,
    ].join("\n");
    // The tracee completed both execs before Node parsed this whole buffered chunk.
    // Its live image is the final SDK for every capture, never the intervening image.
    assert.throws(() => {
      for (const line of chunk.split("\n"))
        if (line.includes(" write(")) f.write(line);
        else f.lifecycle.line(line);
      f.qualify();
    }, /distinct actual executable image/u);
    const refusal = f.lifecycle.events.at(-1)!;
    assert.equal(refusal.kind, "unqualified-exec-image");
    assert.equal(
      Buffer.from(refusal.rawBase64, "base64").toString("latin1"),
      `${chunk.split("\n")[0]}\n`,
    );
    assert.equal(f.lifecycle.actors[refusal.actor].image.sha256, selectedImage.sha256);
    assert.equal(
      f.lifecycle.events.some(({ kind }) => kind === "actual-write-actor"),
      false,
    );
  }
});
