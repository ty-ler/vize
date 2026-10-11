import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NativeActorLifecycle } from "../performance/support/warm-type-backed-owner-lifecycle.ts";
import { ElfHandles } from "../performance/support/warm-type-backed-owner-live-process.ts";
import { NativeTraceCustody } from "../performance/support/warm-type-backed-owner-trace-custody.ts";
import { NativeProtocolStream } from "../performance/support/warm-type-backed-owner-protocol-stream.ts";
import { sha256 } from "../performance/support/warm-type-backed-source.ts";
import {
  actor,
  detached,
  parentImage,
  otherImage,
  selectedImage,
} from "./support/warm-type-backed-owner-lifecycle-fixture.ts";

function fixture() {
  const live = new Map([[10, actor(10)]]);
  const lifecycle = new NativeActorLifecycle(
    10,
    selectedImage,
    (thread) => {
      const value = live.get(thread);
      assert.ok(value, "missing actual early live owner");
      return structuredClone(value);
    },
    () => {},
  );
  lifecycle.initial(live.get(10)!);
  return { live, lifecycle };
}

await test("actual pre-attach thread census and complete clone3 CLONE_THREAD identity are required", () => {
  const { live, lifecycle } = fixture();
  live.set(11, actor(11, 10));
  lifecycle.initial(live.get(11)!);
  live.set(12, actor(12, 10));
  lifecycle.line("10 1.000001 clone3({flags=CLONE_VM|CLONE_THREAD|CLONE_SIGHAND}, 88) = 12");
  lifecycle.line('12 1.000002 write(1<pipe:[101]>, "a", 1) = 1');
  assert.equal(
    lifecycle.finish().history.some((entry) => entry.actor.thread === 12 && entry.bound),
    true,
  );
  assert.throws(() => lifecycle.initial(live.get(11)!));
  for (const changed of [actor(13, 13), actor(13, 10, parentImage, 10)]) {
    const next = fixture();
    next.live.set(13, changed);
    assert.throws(() => next.lifecycle.line("10 1.000003 clone3({flags=CLONE_THREAD}, 88) = 13"));
  }
  const missing = fixture();
  missing.live.set(14, actor(14, 10));
  assert.throws(() => missing.lifecycle.line("10 1.000001 clone3({...}, 88) = 14"), /flags/u);
});

await test("whole fork, unfinished clone and CLONE_PARENT results bind independently observed live children", () => {
  const { live, lifecycle } = fixture();
  live.set(20, actor(20, 20, parentImage, 10));
  lifecycle.line("10 1.000001 fork() = 20");
  live.set(30, actor(30, 30, otherImage, 1));
  lifecycle.line("10 1.000002 clone(child_stack=NULL, flags=CLONE_PARENT|SIGCHLD <unfinished ...>");
  lifecycle.line("10 1.000003 <... clone resumed>) = 30");
  assert.equal(lifecycle.finish().events.length, 3);
  const absent = fixture();
  assert.throws(() => absent.lifecycle.line("10 1.000001 fork() = 20"), /missing actual/u);
  assert.throws(
    () => fixture().lifecycle.line("10 1.000001 <... clone resumed>) = 30"),
    /whole original/u,
  );
  assert.throws(() => lifecycle.line("10 1.000004 clone(flags=CLONE_UNTRACED) = 30"), /untraced/u);
});

await test("a complete leader exec binds actual new image; unrecorded exec and nonleader migration refuse", () => {
  const { live, lifecycle } = fixture();
  live.set(20, actor(20, 20, parentImage, 10));
  lifecycle.line("10 1.000001 fork() = 20");
  lifecycle.line("20 1.000002 execve(0x123, 0x456, 0x789 <unfinished ...>");
  live.set(20, actor(20, 20, selectedImage, 10));
  lifecycle.line("20 1.000003 <... execve resumed>) = 0");
  assert.equal(lifecycle.finish().native[0].executableSHA256, selectedImage.sha256);
  live.delete(20);
  assert.equal(
    lifecycle.nativeWitnesses()[0].pid,
    20,
    "the earlier whole live ELF owner remains available after /proc retirement",
  );
  assert.throws(() => lifecycle.measuredNativeWitnesses(20, 20), /missing actual/u);
  lifecycle.line("20 1.000004 exit_group(0) = ?");
  assert.equal(lifecycle.measuredNativeWitnesses(20, 20)[0].pid, 20);
  const migrated = fixture();
  migrated.live.set(20, actor(20, 20, selectedImage, 10));
  migrated.lifecycle.line("10 1.000001 fork() = 20");
  migrated.live.set(20, actor(20, 20, otherImage, 10));
  migrated.lifecycle.line("20 1.000002 execve(0x123, 0x456, 0x789) = 0");
  assert.throws(() => migrated.lifecycle.measuredNativeWitnesses(20, 20), /past SDK identity/u);
  const unrecorded = fixture();
  unrecorded.live.set(10, actor(10, 10, selectedImage));
  assert.throws(
    () => unrecorded.lifecycle.line('10 1.000002 write(1<pipe:[101]>, "a", 1) = 1'),
    /unwitnessed exec/u,
  );
  const nonleader = fixture();
  nonleader.live.set(11, actor(11, 10));
  nonleader.lifecycle.initial(nonleader.live.get(11)!);
  assert.throws(
    () => nonleader.lifecycle.line("11 1.000003 execve(0x123, 0x456, 0x789) = 0"),
    /nonleader/u,
  );
  assert.throws(
    () => fixture().lifecycle.line('10 1.000001 execve("/foreign", ["argv"], ["env"]) = 0'),
    /raw pointers/u,
  );
});

await test("known kernel exit retains pre-exit owner, while unwitnessed PID reuse and unbound writes refuse", () => {
  const { live, lifecycle } = fixture();
  live.set(20, actor(20, 20, otherImage, 10));
  lifecycle.line("10 1.000001 fork() = 20");
  live.delete(20);
  lifecycle.line("20 1.000002 exit_group(0) = ?");
  live.set(20, actor(20, 20, otherImage, 10, 999));
  lifecycle.line("10 1.000003 fork() = 20");
  assert.equal(lifecycle.finish().history.at(-1)!.actor.threadBirthTicks, 999);
  live.set(20, actor(20, 20, otherImage, 10, 888));
  assert.throws(() => lifecycle.line('20 1.000004 write(1<pipe:[201]>, "a", 1) = 1'), /reuse/u);
  const unbound = fixture();
  unbound.live.set(99, actor(99, 99, otherImage, 10));
  unbound.lifecycle.line('99 1.000001 write(1<pipe:[991]>, "a", 1) = 1');
  assert.throws(() => unbound.lifecycle.finish(), /unbound/u);
});

await test("the original detached50 bytes remain refused without complete early independent non-native ownership", () => {
  assert.throws(() => fixture().lifecycle.line(detached), /missing live birth/u);
  for (const image of [parentImage, selectedImage, { ...selectedImage, inode: "foreign-copy" }]) {
    const { live, lifecycle } = fixture();
    live.set(16129, actor(16129, 16129, image, 10));
    lifecycle.line("10 1791703236.500000 fork() = 16129");
    assert.throws(() => lifecycle.line(detached), /refuse/u);
  }
  const { live, lifecycle } = fixture();
  live.set(16129, actor(16129, 16129, otherImage, 10));
  lifecycle.line("10 1791703236.500000 fork() = 16129");
  assert.equal(lifecycle.line(detached), true);
  const event = lifecycle.finish().events.at(-1)!;
  const raw = Buffer.from(event.rawBase64, "base64");
  assert.equal(raw.length, 50);
  assert.equal(sha256(raw), "fd66621e451a59245bda050a7744a6fbb50ee89a930bebfe376a324bbfd344e5");
  assert.equal(lifecycle.actors[event.actor].process.executableSHA256, otherImage.sha256);
  const vanished = fixture();
  vanished.live.set(16129, actor(16129, 16129, otherImage, 10));
  vanished.lifecycle.line("10 1791703236.500000 fork() = 16129");
  vanished.live.delete(16129);
  assert.throws(() => vanished.lifecycle.line(detached), /missing actual/u);
  const reused = fixture();
  reused.live.set(16129, actor(16129, 16129, otherImage, 10));
  reused.lifecycle.line("10 1791703236.500000 fork() = 16129");
  reused.live.set(16129, actor(16129, 16129, otherImage, 10, 999));
  assert.throws(() => reused.lifecycle.line(detached), /reuse/u);
  const executed = fixture();
  executed.live.set(16129, actor(16129, 16129, otherImage, 10));
  executed.lifecycle.line("10 1791703236.500000 fork() = 16129");
  executed.live.set(16129, actor(16129, 16129, selectedImage, 10));
  assert.throws(() => executed.lifecycle.line(detached), /unwitnessed exec/u);
});

await test("partial or shared descriptor ownership cannot classify the detached actor as unselected", () => {
  for (const partial of [true, false]) {
    const { live, lifecycle } = fixture();
    const value = actor(16129, 16129, otherImage, 10);
    if (partial) value.descriptorFailures.push({ fd: 3, error: "ENOENT" });
    else value.descriptors.push({ fd: 3, target: "pipe:[101]" });
    live.set(16129, value);
    lifecycle.line("10 1791703236.500000 fork() = 16129");
    assert.throws(() => lifecycle.line(detached), /ownership|transport/u);
  }
  const acquired = fixture();
  const acquiring = actor(16129, 16129, otherImage, 10);
  acquired.live.set(16129, acquiring);
  acquired.lifecycle.line("10 1791703236.500000 fork() = 16129");
  acquiring.descriptors.push({ fd: 3, target: "pipe:[101]" });
  assert.throws(() => acquired.lifecycle.line(detached), /parent transport/u);
  const { live, lifecycle } = fixture();
  const value = actor(16129, 16129, otherImage, 10);
  value.descriptors.push({ fd: 3, target: "pipe:[201]" });
  live.set(16129, value);
  lifecycle.line("10 1791703236.500000 fork() = 16129");
  lifecycle.line(detached);
  live.set(20, actor(20, 20, selectedImage, 10));
  lifecycle.line("10 1791703236.700000 fork() = 20");
  assert.throws(() => lifecycle.finish(), /native pipe owner/u);
});

await test("actual retained inode handles hash all bytes and refuse changed files despite the same path", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owner-elf-"));
  const handles = new ElfHandles();
  try {
    const file = path.join(directory, "different-basename");
    const bytes = Buffer.concat([Buffer.from([127, 69, 76, 70]), Buffer.alloc(256, 7)]);
    fs.writeFileSync(file, bytes);
    const first = handles.read(file);
    assert.equal(first.sha256, sha256(bytes));
    assert.equal(first.elf, true);
    fs.symlinkSync(file, path.join(directory, "tsc"));
    assert.deepEqual(handles.read(path.join(directory, "tsc")), first);
    fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from([8])]));
    assert.throws(() => handles.read(file), /remain immutable/u);
  } finally {
    handles.close();
    fs.rmSync(directory, { recursive: true });
  }
});

await test("whole raw custody preserves binary bytes and original decoder still refuses unknown50 record", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owner-trace-"));
  try {
    const custody = new NativeTraceCustody(directory);
    const bytes = Buffer.from([255, 0, 127, 10]);
    custody.input(bytes);
    custody.record({ whole: Buffer.from(`${detached}\n`).toString("base64") });
    assert.deepEqual(fs.readFileSync(custody.raw), bytes);
    assert.equal(custody.snapshot().raw.sha256, sha256(bytes));
    const stream = new NativeProtocolStream(() => {});
    assert.throws(() => stream.push(Buffer.from(`${detached}\n`)), /unknown syscall/u);
    assert.equal(Buffer.from(stream.snapshot().rejectedLine!.rawBase64, "base64").length, 50);
    assert.throws(() => custody.input(Buffer.alloc(64 * 1024 * 1024)), /original finite bound/u);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
