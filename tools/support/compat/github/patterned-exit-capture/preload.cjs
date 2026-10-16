// Diagnostic only: observe this child without consuming stdin, handling signals,
// replacing its process, or writing either protocol stream.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { registerHooks, syncBuiltinESMExports } = require("node:module");

const directory = process.env.VIZE_PATTERNED_EXIT_PACKET;
if (!directory) throw new Error("Missing owned child packet directory");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const append = fs.appendFileSync.bind(fs);
const write = fs.writeSync.bind(fs);
const birth = fs.readFileSync("/proc/self/stat", "utf8").split(") ").at(-1).split(" ")[19];
let sequence = 0;
const record = (event, detail = {}) => {
  append(
    path.join(directory, "events.jsonl"),
    `${JSON.stringify({
      event,
      pid: process.pid,
      ppid: process.ppid,
      birth,
      sequence: sequence++,
      monotonic: process.hrtime.bigint().toString(),
      ...detail,
    })}\n`,
  );
};
// Linux sysmacros encoding, including devices whose major/minor exceed 8 bits.
const deviceParts = (value) => ({
  major: ((value >> 8n) & 0xfffn) | ((value >> 32n) & 0xfffff000n),
  minor: (value & 0xffn) | ((value >> 12n) & 0xffffff00n),
});
const identity = (filename, mappedInode, mappedDevice) => {
  const descriptor = fs.openSync(filename, "r");
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw new Error("Provider changed while reading its open descriptor");
    const sha256 = hash(bytes);
    const physicalDevice = deviceParts(before.dev);
    const mappedDeviceParts = mappedDevice?.split(":").map((part) => BigInt(`0x${part}`));
    const inodeMatches = mappedInode === undefined ? null : String(before.ino) === mappedInode;
    const deviceMatches =
      mappedDeviceParts === undefined
        ? null
        : physicalDevice.major === mappedDeviceParts[0] &&
          physicalDevice.minor === mappedDeviceParts[1];
    // Only native addons and the executable need retained bytes for this small
    // capture. Library hashes/maps are observations, not a retained core sysroot.
    if (filename === "/proc/self/exe" || filename.endsWith(".node")) {
      const retained = path.join(directory, "..", "images", sha256);
      try {
        fs.writeFileSync(retained, bytes, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    return {
      filename,
      realpath: fs.realpathSync(filename),
      sha256,
      bytes: bytes.length,
      inode: String(before.ino),
      device: String(before.dev),
      mappedInode,
      mappedDevice,
      deviceMajor: String(physicalDevice.major),
      deviceMinor: String(physicalDevice.minor),
      inodeMatches,
      deviceMatches,
      mappedIdentityMatches: mappedInode === undefined ? null : inodeMatches && deviceMatches,
    };
  } finally {
    fs.closeSync(descriptor);
  }
};
const measured = new Map();
const capture = (event, detail = {}) => {
  try {
    const maps = fs.readFileSync("/proc/self/maps", "utf8");
    const providers = [];
    for (const line of maps.trim().split("\n")) {
      const match = /^\S+\s+\S+\s+\S+\s+([a-f0-9]+:[a-f0-9]+)\s+(\d+)\s+(.+)$/iu.exec(line);
      if (!match || !/\.(?:node|so(?:\.\d+)*)$/u.test(match[3])) continue;
      const key = `${match[1]}:${match[2]}:${match[3]}`;
      if (!measured.has(key)) measured.set(key, identity(match[3], match[2], match[1]));
      if (!providers.includes(measured.get(key))) providers.push(measured.get(key));
    }
    const mapsFile = `${sequence}-${event}.maps`;
    fs.writeFileSync(path.join(directory, mapsFile), maps, { flag: "wx" });
    record(event, { mapsFile, providers, ...detail });
  } catch (error) {
    // A failed observation is visible and rejected by the driver; do not alter
    // the target's control flow or mistake missing evidence for a clean exit.
    record("observation-gap", { at: event, error: String(error) });
  }
};
capture("start", {
  executable: identity("/proc/self/exe"),
  argv: process.argv,
  cwd: process.cwd(),
  version: process.version,
  versions: process.versions,
  sourceSha: process.env.VIZE_PATTERNED_EXIT_SOURCE,
});
const dlopen = process.dlopen;
process.dlopen = function (...args) {
  capture("dlopen-entry", { filename: String(args[1]) });
  try {
    return Reflect.apply(dlopen, this, args);
  } finally {
    capture("dlopen-return", { filename: String(args[1]) });
  }
};
fs.writeSync = function (...args) {
  const protocol = args[0] === 1;
  if (protocol) record("stdout-write-entry");
  const result = Reflect.apply(write, fs, args);
  if (protocol) record("stdout-write-return", { written: result });
  return result;
};
syncBuiltinESMExports();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("data:text/javascript;base64,")) {
      const bytes = Buffer.from(specifier.slice("data:text/javascript;base64,".length), "base64");
      const sha256 = hash(bytes);
      const filename = path.join(directory, `module-${sha256}.mjs`);
      if (!fs.existsSync(filename)) fs.writeFileSync(filename, bytes, { flag: "wx" });
      record("data-module", { sha256, bytes: bytes.length, parentURL: context.parentURL });
    }
    return nextResolve(specifier, context);
  },
});
process.on("beforeExit", (code) => capture("beforeExit", { code }));
process.on("exit", (code) => capture("exit", { code }));
