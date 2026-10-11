import assert from "node:assert/strict";
import type { NativeActorLifecycle } from "./warm-type-backed-owner-lifecycle.ts";
import type { ElfIdentity, LiveActor } from "./warm-type-backed-owner-live-process.ts";
import type { NativeProcessWitness, syscallWrites } from "./warm-type-backed-owner-syscalls.ts";

type Event = NativeActorLifecycle["events"][number];
type Origin = { event: Event; entry?: Event; fd: number };

function sameProcess(actor: LiveActor, process: NativeProcessWitness) {
  return (
    actor.tgid === process.pid &&
    actor.processBirthTicks === process.birthTicks &&
    actor.status.ppid === process.ppid &&
    actor.process.executable === process.executable &&
    actor.image.sha256 === process.executableSHA256 &&
    actor.process.stdin === process.stdin &&
    actor.process.stdout === process.stdout
  );
}

/** Join each original complete write to its whole kernel event and current live executable epoch. */
export function authenticateWriteEpochs(
  writes: ReturnType<typeof syscallWrites>,
  lifecycle: Pick<NativeActorLifecycle, "events" | "actors" | "history">,
  selected: ElfIdentity,
  witnesses: NativeProcessWitness[],
  parents: NativeProcessWitness[],
) {
  const parentBirth = lifecycle.history.find(
    ({ actor, origin }) =>
      actor.thread === parents[0]?.pid && origin === "actual-pre-attach-kernel-census",
  );
  assert.ok(parentBirth, "the original launch requires its actual pre-attach ELF birth");
  const origins = new Map<string, Origin[]>();
  const pending = new Map<number, { event: Event; fd: number }>();
  for (const event of lifecycle.events) {
    if (event.kind !== "actual-write-actor") continue;
    const raw = Buffer.from(event.rawBase64, "base64").toString("latin1");
    assert.ok(raw.endsWith("\n"));
    const line = raw.slice(0, -1);
    const body = line.replace(/^(?:\[pid\s+\d+\]|\d+)\s+\d+\.\d+\s+/u, "");
    let origin: Origin;
    if (body.startsWith("<... write resumed>")) {
      const entry = pending.get(event.thread);
      assert.ok(entry, "the resumed write needs its whole earlier actor/FD event");
      pending.delete(event.thread);
      origin = { event, entry: entry.event, fd: entry.fd };
    } else {
      const fd = Number(body.match(/^write\((\d+)</u)?.[1]);
      assert.ok(Number.isSafeInteger(fd) && fd >= 0);
      if (body.endsWith("<unfinished ...>")) {
        assert.equal(pending.has(event.thread), false);
        pending.set(event.thread, { event, fd });
        continue;
      }
      origin = { event, fd };
    }
    const rows = origins.get(line) ?? [];
    rows.push(origin);
    origins.set(line, rows);
  }
  assert.equal(pending.size, 0, "unfinished actor/FD writes cannot qualify");
  return writes.map((write) => {
    const origin = origins.get(write.line)?.shift();
    assert.ok(origin, "every original write needs its exact whole lifecycle event");
    const actor = lifecycle.actors[origin.event.actor];
    assert.ok(actor && actor.thread === write.thread);
    const target = write.descriptor.startsWith("UNIX-STREAM:")
      ? `socket:[${write.descriptor.match(/^UNIX-STREAM:\[(\d+)/u)?.[1]}]`
      : write.descriptor;
    const actors = origin.entry ? [lifecycle.actors[origin.entry.actor], actor] : [actor];
    for (const current of actors) {
      assert.equal(current.thread, actor.thread);
      assert.equal(current.threadBirthTicks, actor.threadBirthTicks, "write TID reuse refuses");
      assert.equal(current.tgid, actor.tgid);
      assert.equal(current.processBirthTicks, actor.processBirthTicks, "write PID reuse refuses");
      assert.deepEqual(current.image, actor.image, "write executable epoch changed");
      assert.equal(current.descriptorFailures.length, 0, "partial write FD authority refuses");
      assert.equal(
        current.descriptors.find(({ fd }) => fd === origin.fd)?.target,
        target,
        "the original write FD must belong to its actual current actor",
      );
    }
    const socket = write.descriptor.match(/^UNIX-STREAM:\[(\d+)(?:->(\d+))?/u);
    for (const native of witnesses) {
      const nativeThreads =
        native.threads.includes(write.thread) ||
        (sameProcess(actor, native) &&
          witnesses.some(
            (current) => sameProcess(actor, current) && current.threads.includes(write.thread),
          ));
      const parentThreads = parents.some(({ threads }) => threads.includes(write.thread));
      const server =
        (nativeThreads && write.descriptor === native.stdout) ||
        native.sockets.some(({ inode }) => socket?.[1] === inode);
      const client =
        (parentThreads && write.descriptor === native.stdin) ||
        native.sockets.some(({ inode }) => socket?.[2] === inode);
      if (write.descriptor === native.stdout)
        assert.ok(server, "a foreign writer cannot use the native stdout pipe");
      if (write.descriptor === native.stdin)
        assert.ok(client, "a foreign writer cannot use the native stdin pipe");
      if (server) {
        assert.ok(sameProcess(actor, native), "native bytes need the current actual process epoch");
        assert.equal(actor.image.device, selected.device);
        assert.equal(actor.image.inode, selected.inode);
        assert.equal(actor.image.sha256, selected.sha256);
        assert.ok(actor.image.elf);
      }
      if (client) {
        assert.ok(
          parents.some((parent) => sameProcess(actor, parent)),
          "client bytes need the current original launch epoch",
        );
        assert.deepEqual(actor.image, parentBirth.actor.image, "the client ELF epoch changed");
      }
      assert.equal(
        server && client,
        false,
        "independent socket/pipe writers cannot share authority",
      );
    }
    return {
      line: write.line,
      thread: write.thread,
      descriptor: write.descriptor,
      fd: origin.fd,
      actor: origin.event.actor,
      entryActor: origin.entry?.actor,
    };
  });
}
