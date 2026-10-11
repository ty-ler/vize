"""Finite unchanged-source coverage experiment; never a shipping gate receipt."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time


SOURCE_SHA = "2ce2d2b75cfa9ba14f322a99de8f7146b623b8fe"
SOURCE = Path(sys.argv[1]).resolve()
OUTPUT = Path(sys.argv[2]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)


def write(name, value):
    (OUTPUT / name).write_text(json.dumps(value, indent=2) + "\n")


def git(*args):
    return subprocess.check_output(["git", "-C", str(SOURCE), *args])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_manifest():
    assert git("rev-parse", "HEAD").decode().strip() == SOURCE_SHA
    assert not git("diff", "--name-only", "HEAD"), "Tracked source changed"
    files = []
    for entry in git("ls-files", "--stage", "-z").split(b"\0"):
        if not entry:
            continue
        meta, raw_path = entry.split(b"\t", 1)
        mode, blob, stage = meta.decode().split()
        path = os.fsdecode(raw_path)
        assert stage == "0", "Unmerged source entry"
        if mode == "160000":
            files.append({"path": path, "mode": mode, "gitlink": blob})
            continue
        file = SOURCE / path
        data = os.fsencode(os.readlink(file)) if mode == "120000" else file.read_bytes()
        actual_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        assert actual_blob == blob, "Physical source differs: " + path
        files.append({"path": path, "mode": mode, "blob": blob,
                      "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    return {"sourceSha": SOURCE_SHA, "tree": git("rev-parse", "HEAD^{tree}").decode().strip(),
            "files": files}


def read_proc():
    rows = []
    for directory in Path("/proc").iterdir():
        if not directory.name.isdigit():
            continue
        try:
            raw = (directory / "stat").read_text()
            close = raw.rfind(")")
            fields = raw[close + 2:].split()
            rows.append({"pid": int(directory.name), "comm": raw[raw.find("(") + 1:close],
                         "state": fields[0], "ppid": int(fields[1]),
                         "utimeTicks": int(fields[11]), "stimeTicks": int(fields[12]),
                         "threads": int(fields[17]), "startTicks": int(fields[19]),
                         "vsizeBytes": int(fields[20]), "rssPages": int(fields[21])})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return rows


def host_snapshot():
    files = ["loadavg", "pressure/cpu", "pressure/memory", "pressure/io",
             "sys/kernel/threads-max", "sys/kernel/pid_max"]
    result = {}
    for name in files:
        path = Path("/proc") / name
        if path.exists():
            result[name] = path.read_text()
    for name in ["cpu.max", "cpu.stat", "memory.current", "memory.max", "memory.events", "pids.current", "pids.max"]:
        path = Path("/sys/fs/cgroup") / name
        if path.exists():
            result["cgroup/" + name] = path.read_text()
    return result


def runtime_receipts():
    candidates = set()
    for root in [SOURCE / "node_modules", SOURCE / "playground/node_modules"]:
        if not root.exists():
            continue
        for pattern in ["@typescript/typescript-linux-x64/lib/tsc",
                        ".pnpm/@typescript+typescript-linux-x64*/node_modules/@typescript/typescript-linux-x64/lib/tsc"]:
            candidates.update(path.resolve() for path in root.glob(pattern) if path.is_file())
    assert candidates, "No frozen actual native TypeScript executable"
    result = []
    for binary in sorted(candidates):
        package = binary.parent.parent / "package.json"
        manifest = json.loads(package.read_text())
        assert manifest["name"] == "@typescript/typescript-linux-x64" and manifest["version"] == "7.0.2"
        version = subprocess.run([str(binary), "--version"], capture_output=True, check=True)
        result.append({"binary": str(binary), "sha256": sha(binary),
                       "packageSha256": sha(package), "package": manifest,
                       "versionStdout": version.stdout.decode(), "versionStderr": version.stderr.decode()})
    vue = (SOURCE / "playground/node_modules/vue").resolve()
    return {"native": result, "vuePath": str(vue),
            "vuePackageSha256": sha(vue / "package.json"),
            "vueDeclarationSha256": sha(vue / "dist/vue.d.ts")}


def run_suite(binary, index, threads):
    prefix = f"{index:02d}-{'host-default' if threads is None else 'four-threads'}"
    command = [str(binary), "--nocapture"]
    if threads is not None:
        command.append("--test-threads=" + str(threads))
    baseline = read_proc()
    known = set()
    stop = threading.Event()
    peak = {"ownedProcesses": 0, "ownedThreads": 0, "ownedRssBytes": 0}
    start = time.monotonic()
    with (OUTPUT / (prefix + ".stdout")).open("wb") as stdout, \
            (OUTPUT / (prefix + ".stderr")).open("wb") as stderr, \
            (OUTPUT / (prefix + ".proc.jsonl")).open("w") as telemetry:
        child = subprocess.Popen(command, cwd=SOURCE, stdout=stdout, stderr=stderr)

        def sample():
            while not stop.is_set():
                rows = read_proc()
                current = {child.pid}
                changed = True
                while changed:
                    before = len(current)
                    current.update(row["pid"] for row in rows if row["ppid"] in current)
                    changed = len(current) != before
                known.update((row["pid"], row["startTicks"]) for row in rows if row["pid"] in current)
                owned = [row for row in rows if (row["pid"], row["startTicks"]) in known]
                peak["ownedProcesses"] = max(peak["ownedProcesses"], len(owned))
                peak["ownedThreads"] = max(peak["ownedThreads"], sum(row["threads"] for row in owned))
                peak["ownedRssBytes"] = max(peak["ownedRssBytes"], sum(row["rssPages"] for row in owned) * os.sysconf("SC_PAGE_SIZE"))
                telemetry.write(json.dumps({"monotonicSeconds": time.monotonic() - start,
                                            "wallNanoseconds": time.time_ns(), "rootPid": child.pid,
                                            "owned": owned, "wholeCensus": rows,
                                            "host": host_snapshot()}, separators=(",", ":")) + "\n")
                telemetry.flush()
                stop.wait(0.2)

        sampler = threading.Thread(target=sample)
        sampler.start()
        try:
            exit_code = child.wait()
            elapsed = time.monotonic() - start
            # Observe original cleanup; never kill a process or extend a test deadline.
            time.sleep(5)
        finally:
            stop.set()
            sampler.join()
    remaining = [row for row in read_proc() if (row["pid"], row["startTicks"]) in known]
    text = (OUTPUT / (prefix + ".stdout")).read_text()
    summaries = re.findall(r"test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;.*", text)
    assert len(summaries) == 1 and sum(map(int, summaries[0])) == 1334, "Original suite census changed"
    receipt = {"index": index, "command": command, "threads": threads, "pid": child.pid,
               "exitCode": exit_code, "elapsedSeconds": elapsed, "wholeResultSummary": summaries[0],
               "wholeStdoutSha256": sha(OUTPUT / (prefix + ".stdout")),
               "wholeStderrSha256": sha(OUTPUT / (prefix + ".stderr")),
               "baselineCensus": baseline, "peakOwned": peak, "remainingOwned": remaining}
    write(prefix + ".json", receipt)
    assert not remaining, "Original owned descendants remain; refuse overlapping the next arm"
    return receipt


before = source_manifest()
if len(sys.argv) > 3 and sys.argv[3] == "--before-build":
    write("whole-source-before-build.json", before)
    write("runtime-before-build.json", runtime_receipts())
    sys.exit(0)
assert json.loads((OUTPUT / "whole-source-before-build.json").read_text()) == before
write("whole-source-before.json", before)
write("runtime-before.json", runtime_receipts())
assert json.loads((OUTPUT / "runtime-before-build.json").read_text()) == runtime_receipts()
artifact_lines = (OUTPUT / "build.stdout.jsonl").read_text().splitlines()
artifacts = [json.loads(line) for line in artifact_lines if line.startswith("{")]
executables = {row["executable"] for row in artifacts
               if row.get("reason") == "compiler-artifact" and row.get("executable")
               and row["target"]["name"] == "vize_maestro" and row["profile"]["test"]}
assert len(executables) == 1, "Ambiguous original instrumented Maestro test executable"
binary = Path(executables.pop()).resolve()
listing = subprocess.check_output([str(binary), "--list"], cwd=SOURCE)
(OUTPUT / "original-test-list.stdout").write_bytes(listing)
assert len(re.findall(rb": test\r?$", listing, re.MULTILINE)) == 1334
assert os.environ.get("RUST_TEST_THREADS") is None, "Host-default arm must retain original absence"
write("experiment.json", {"sourceSha": SOURCE_SHA, "driverSha": os.environ["GITHUB_SHA"],
                         "binary": str(binary), "binarySha256": sha(binary),
                         "testListSha256": hashlib.sha256(listing).hexdigest(),
                         "hostCpuCount": os.cpu_count(), "hostAffinity": sorted(os.sched_getaffinity(0)),
                         "sampleIntervalSeconds": 0.2, "sampledPeaksAreLowerBounds": True,
                         "initialHost": host_snapshot(),
                         "environment": {name: os.environ.get(name) for name in
                                         ["RUST_TEST_THREADS", "GOMAXPROCS", "RAYON_NUM_THREADS",
                                          "CARGO_INCREMENTAL", "RUSTFLAGS", "LLVM_PROFILE_FILE",
                                          "VIZE_TEST_REQUIRE_TSGO", "VIZE_TEST_DISABLE_TSGO"]},
                         "method": "Finite ABBA: complete original 1334 tests, same instrumented binary, host-default/4/4/host-default; no original deadlines or source edits; workspace compilation preserves feature unification; earlier workspace test execution is absent; this does not qualify full coverage"})
results = [run_suite(binary, index, threads) for index, threads in enumerate([None, 4, 4, None], 1)]
after = source_manifest()
write("whole-source-after.json", after)
assert before == after, "Original whole-source bytes changed during experiment"
runtime_after = runtime_receipts()
write("runtime-after.json", runtime_after)
assert json.loads((OUTPUT / "runtime-before.json").read_text()) == runtime_after
write("results.json", {"sourceSha": SOURCE_SHA, "originalSourceAndRuntimePreserved": True,
                       "shippingFullCoverageQualified": False, "arms": results})
print(json.dumps({"sourceSha": SOURCE_SHA, "arms": [{"index": r["index"], "threads": r["threads"],
                                                      "exitCode": r["exitCode"], "elapsedSeconds": r["elapsedSeconds"],
                                                      "peakOwned": r["peakOwned"]} for r in results]}))
