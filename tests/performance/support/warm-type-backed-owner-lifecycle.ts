import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ElfIdentity, LiveActor } from "./warm-type-backed-owner-live-process.ts";

type Capture = (thread: number) => LiveActor;
type Entry = { actor: LiveActor; origin: string; bound: boolean; retired: boolean };
type Event = { rawBase64: string; thread: number; timestamp: string; actor: number; kind: string };

function sameImage(a: ElfIdentity, b: ElfIdentity) {
  return a.device === b.device && a.inode === b.inode && a.sha256 === b.sha256;
}

/** Source-bound kernel lifecycle; absent live evidence never becomes an inferred identity. */
export class NativeActorLifecycle {
  readonly events: Event[] = [];
  readonly history: Entry[] = [];
  private readonly active = new Map<number, Entry>();
  private readonly pending = new Map<number, { name: string; body: string }>();
  private readonly unselected: Entry[] = [];
  private readonly snapshots = new Map<string, number>();
  readonly actors: LiveActor[] = [];
  readonly parent: number;
  readonly selected: ElfIdentity;
  private readonly capture: Capture;
  private readonly retain: (event: Event) => void;

  constructor(
    parent: number,
    selected: ElfIdentity,
    capture: Capture,
    retain: (event: Event) => void,
  ) {
    assert.ok(selected.elf, "selected native authority must be the full actual ELF");
    this.parent = parent;
    this.selected = selected;
    this.capture = capture;
    this.retain = retain;
  }

  initial(actor: LiveActor) {
    assert.equal(this.active.has(actor.thread), false, "initial thread census must be unique");
    this.remember(actor, "actual-pre-attach-kernel-census", true);
  }

  private remember(actor: LiveActor, origin: string, bound: boolean, exec = false) {
    assert.equal(actor.thread, actor.status.pid);
    assert.equal(actor.tgid, actor.status.tgid);
    assert.equal(actor.process.pid, actor.tgid);
    assert.equal(actor.process.birthTicks, actor.processBirthTicks);
    assert.equal(actor.process.executableSHA256, actor.image.sha256);
    const prior = this.active.get(actor.thread);
    if (prior) {
      assert.equal(prior.retired, false, "retired thread IDs require a new kernel birth");
      assert.equal(
        prior.actor.threadBirthTicks,
        actor.threadBirthTicks,
        "unwitnessed TID reuse refuses",
      );
      assert.equal(prior.actor.tgid, actor.tgid, "unwitnessed thread-group migration refuses");
      assert.equal(prior.actor.processBirthTicks, actor.processBirthTicks, "PID reuse refuses");
      assert.ok(exec || sameImage(prior.actor.image, actor.image), "unwitnessed exec refuses");
      bound ||= prior.bound;
    }
    if (bound)
      for (const entry of this.history)
        if (
          entry.actor.thread === actor.thread &&
          entry.actor.threadBirthTicks === actor.threadBirthTicks
        )
          entry.bound = true;
    const entry = { actor: structuredClone(actor), origin, bound, retired: false };
    this.active.set(actor.thread, entry);
    this.history.push(entry);
    return entry;
  }

  private live(thread: number, exec = false) {
    return this.remember(this.capture(thread), "actual-live-kernel-event", false, exec);
  }

  private known(thread: number) {
    const entry = this.active.get(thread);
    assert.ok(entry?.bound && !entry.retired, "missing live birth/thread authority refuses");
    return entry;
  }

  private event(raw: string, thread: number, timestamp: string, entry: Entry, kind: string) {
    const complete = JSON.stringify(entry.actor);
    const key = createHash("sha256").update(complete).digest("hex");
    let actor = this.snapshots.get(key);
    if (actor === undefined) {
      actor = this.actors.length;
      this.actors.push(structuredClone(entry.actor));
      this.snapshots.set(key, actor);
    } else
      assert.equal(
        JSON.stringify(this.actors[actor]),
        complete,
        "whole actor snapshot collision refuses",
      );
    const event = {
      rawBase64: Buffer.from(`${raw}\n`, "latin1").toString("base64"),
      thread,
      timestamp,
      actor,
      kind,
    };
    this.events.push(event);
    this.retain(event);
  }

  private birth(thread: number, name: string, body: string, result: number) {
    const parent = this.known(thread);
    assert.ok(Number.isSafeInteger(result) && result > 0);
    const child = this.capture(result);
    const flags = ["fork", "vfork"].includes(name)
      ? "0"
      : body.match(/(?:\bflags=)([^,})\s]+)/u)?.[1];
    assert.ok(flags, "complete actual clone flags are mandatory");
    assert.match(
      flags,
      /^(?:CLONE_[A-Z0-9_]+|SIG[A-Z0-9]+|0)(?:\|(?:CLONE_[A-Z0-9_]+|SIG[A-Z0-9]+))*$/u,
    );
    const words = new Set(flags.split("|"));
    assert.equal(words.has("CLONE_UNTRACED"), false, "untraced descendants cannot grant authority");
    const sharedThread = words.has("CLONE_THREAD");
    assert.equal(child.tgid, sharedThread ? parent.actor.tgid : result);
    assert.equal(
      child.status.ppid,
      sharedThread || words.has("CLONE_PARENT") ? parent.actor.status.ppid : parent.actor.tgid,
    );
    const previous = this.active.get(result);
    if (previous?.retired) this.active.delete(result);
    const entry = this.remember(child, "actual-kernel-birth-and-live-child", true);
    if (sharedThread)
      assert.ok(sameImage(parent.actor.image, child.image), "a thread shares its actual image");
    return entry;
  }

  /** Returns true only for kernel metadata; writes still enter the original strict byte decoder. */
  line(raw: string): boolean {
    const prefix = raw.match(/^(?:\[pid\s+(\d+)\]|(\d+))\s+(\d+\.\d+)\s+(.*)$/u);
    assert.ok(prefix, "kernel event thread/time is mandatory");
    const thread = Number(prefix[1] ?? prefix[2]);
    const timestamp = prefix[3];
    let body = prefix[4];
    if (
      /^\+\+\+ (?:exited with -?\d+|killed by SIG[A-Z0-9]+(?: \(core dumped\))?) \+\+\+$/u.test(
        body,
      )
    ) {
      const entry = this.active.get(thread);
      assert.ok(entry?.bound, "kernel retirement needs the retained actual birth authority");
      this.event(raw, thread, timestamp, entry, "kernel-tracee-retirement");
      entry.retired = true;
      return false;
    }
    if (body.startsWith("write(") || body.startsWith("<... write resumed>")) {
      const entry = this.live(thread);
      this.event(raw, thread, timestamp, entry, "actual-write-actor");
      return false;
    }
    if (/^\?\?\?\( <detached \.\.\.>$/u.test(body)) {
      this.known(thread);
      const entry = this.live(thread);
      const parent = this.live(this.parent);
      assert.equal(this.pending.has(thread), false, "undecoded pending lifecycle refuses");
      assert.equal(
        sameImage(entry.actor.image, this.selected),
        false,
        "undecoded selected-native record refuses",
      );
      assert.notEqual(
        entry.actor.image.sha256,
        this.selected.sha256,
        "foreign copies of the native ELF refuse",
      );
      assert.equal(
        this.history.some(
          ({ actor }) =>
            actor.tgid === entry.actor.tgid &&
            actor.processBirthTicks === entry.actor.processBirthTicks &&
            actor.image.sha256 === this.selected.sha256,
        ),
        false,
        "an actor with any actual selected-native execution epoch cannot waive an undecoded record",
      );
      assert.equal(
        sameImage(entry.actor.image, parent.actor.image),
        false,
        "undecoded parent transport refuses",
      );
      assert.equal(
        entry.actor.descriptorFailures.length,
        0,
        "partial descriptor ownership refuses",
      );
      const protectedDescriptors = new Set(parent.actor.descriptors.map(({ target }) => target));
      assert.equal(
        entry.actor.descriptors.some(({ target }) => protectedDescriptors.has(target)),
        false,
        "a parent transport owner cannot be unselected",
      );
      this.unselected.push(entry);
      this.event(raw, thread, timestamp, entry, "authenticated-non-native-detach");
      entry.retired = true;
      return true;
    }
    const resumed = body.match(
      /^<\.\.\. (clone3?|fork|vfork|execve(?:at)?|exit_group|exit) resumed>(.*)$/u,
    );
    if (resumed) {
      const pending = this.pending.get(thread);
      assert.equal(pending?.name, resumed[1], "resumed lifecycle requires its whole original call");
      body = pending!.body + resumed[2];
      this.pending.delete(thread);
    }
    const call = body.match(/^(clone3?|fork|vfork|execve(?:at)?|exit_group|exit)\(/u);
    if (!call) {
      assert.equal(
        body.includes("pid changed"),
        false,
        "nonleader exec requires complete independent migration authority",
      );
      assert.equal(
        body.includes("superseded by execve"),
        false,
        "nonleader exec cannot inherit a leader witness",
      );
      return false;
    }
    const name = call[1];
    if (body.endsWith("<unfinished ...>")) {
      const actor = this.live(thread);
      assert.equal(this.pending.has(thread), false);
      assert.ok(this.pending.size < 1024);
      this.pending.set(thread, { name, body: body.replace(/\s*<unfinished \.\.\.>$/u, "") });
      this.event(raw, thread, timestamp, actor, "lifecycle-entry");
      return true;
    }
    if (/\)\s+= -1\s+[A-Z][A-Z0-9_]+(?: \([^\n]*\))?$/u.test(body)) {
      const actor = this.live(thread);
      this.event(raw, thread, timestamp, actor, "failed-lifecycle-call");
      return true;
    }
    if (name === "execve" || name === "execveat") {
      assert.match(
        body,
        /^execve(?:at)?\((?:0x[a-f0-9]+|[0-9]+)(?:, (?:0x[a-f0-9]+|[0-9]+|NULL)){2,4}\)\s+= 0$/u,
        "exec metadata must be raw pointers, without foreign argv/env capture",
      );
      const prior = this.known(thread);
      assert.equal(
        prior.actor.thread,
        prior.actor.tgid,
        "nonleader exec requires explicit complete migration authority",
      );
      const image = this.live(thread, true);
      const changed = !sameImage(prior.actor.image, image.actor.image);
      this.event(
        raw,
        thread,
        timestamp,
        image,
        changed ? "successful-exec-with-live-image" : "unqualified-exec-image",
      );
      assert.ok(changed, "exec needs a distinct actual executable image");
      return true;
    }
    if (name === "exit" || name === "exit_group") {
      assert.match(body, /^exit(?:_group)?\(-?\d+\)\s+= \?$/u);
      const actor = this.known(thread);
      this.event(raw, thread, timestamp, actor, "kernel-exit");
      for (const entry of this.active.values())
        if (
          entry.actor.thread === thread ||
          (name === "exit_group" && entry.actor.tgid === actor.actor.tgid)
        )
          entry.retired = true;
      return true;
    }
    const actor = this.live(thread);
    const returned = body.match(/\)\s+= (\d+)$/u);
    assert.ok(returned, "whole kernel birth result is mandatory");
    const child = Number(returned[1]);
    if (child === 0) this.known(thread);
    else this.birth(thread, name, body, child);
    this.event(raw, thread, timestamp, actor, "successful-kernel-birth");
    return true;
  }

  nativeWitnesses() {
    return this.history
      .filter(({ actor, bound }) => bound && sameImage(actor.image, this.selected))
      .map(({ actor }) => structuredClone(actor.process));
  }

  measuredNativeWitnesses(pid: number, birth: number) {
    let current = this.active.get(pid);
    assert.ok(current?.bound, "the measured PID needs its earlier actual kernel birth");
    if (!current.retired) current = this.live(pid);
    assert.equal(
      current.actor.processBirthTicks,
      birth,
      "a measured PID cannot inherit another birth",
    );
    assert.ok(
      sameImage(current.actor.image, this.selected),
      "a past SDK identity cannot grant current exec-epoch authority",
    );
    return this.nativeWitnesses().filter(
      (witness) => witness.pid === pid && witness.birthTicks === birth,
    );
  }

  finish() {
    assert.equal(this.pending.size, 0, "incomplete kernel lifecycle refuses");
    for (const entry of this.history) assert.ok(entry.bound, "unbound actual actors refuse");
    const selected = this.history.filter(({ actor }) => sameImage(actor.image, this.selected));
    const nativeDescriptors = new Set(
      selected.flatMap(({ actor }) => [
        actor.process.stdin,
        actor.process.stdout,
        ...actor.process.sockets.map(({ inode }) => `socket:[${inode}]`),
      ]),
    );
    for (const entry of this.unselected)
      assert.equal(
        this.history
          .filter(
            ({ actor }) =>
              actor.tgid === entry.actor.tgid &&
              actor.processBirthTicks === entry.actor.processBirthTicks,
          )
          .some(({ actor }) =>
            actor.descriptors.some(({ target }) => nativeDescriptors.has(target)),
          ),
        false,
        "an actual native pipe owner cannot be unselected",
      );
    return {
      events: this.events,
      actors: this.actors,
      history: this.history,
      native: this.nativeWitnesses(),
    };
  }
}
