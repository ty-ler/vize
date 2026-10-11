import type {
  ElfIdentity,
  LiveActor,
} from "../../performance/support/warm-type-backed-owner-live-process.ts";

export const parentImage: ElfIdentity = {
  device: "1",
  inode: "10",
  size: "256",
  mtimeNs: "1",
  ctimeNs: "1",
  sha256: "a".repeat(64),
  elf: true,
};
export const selectedImage: ElfIdentity = { ...parentImage, inode: "20", sha256: "b".repeat(64) };
export const otherImage: ElfIdentity = { ...parentImage, inode: "30", sha256: "c".repeat(64) };

/** Explicit injected kernel snapshots; these laws never claim actual Linux acceptance. */
export function actor(
  thread: number,
  tgid = thread,
  image = parentImage,
  ppid = 1,
  birth = thread,
): LiveActor {
  const stdin = `pipe:[${tgid * 10}]`;
  const stdout = `pipe:[${tgid * 10 + 1}]`;
  return {
    thread,
    tgid,
    threadBirthTicks: birth,
    processBirthTicks: tgid,
    status: { pid: thread, tgid, ppid },
    threadStat: `whole explicit thread fixture ${thread}:${birth}`,
    processStat: `whole explicit process fixture ${tgid}`,
    image,
    descriptors: [
      { fd: 0, target: stdin },
      { fd: 1, target: stdout },
    ],
    descriptorFailures: [],
    process: {
      pid: tgid,
      ppid,
      birthTicks: tgid,
      executable: `/fixture/actual-${image.inode}`,
      executableSHA256: image.sha256,
      threads: [tgid, thread],
      stdin,
      stdout,
      sockets: [],
    },
  };
}

export const detached = "[pid 16129] 1791703236.609266 ???( <detached ...>";
