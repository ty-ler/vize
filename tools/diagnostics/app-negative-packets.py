"""Finite, observer-only custody for two original release445 negative controls."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback

SOURCE = "605429c660b328bb03bec5bbfef15961e59fcaf0"
PINS = {
    "element-plus": "20298a21ae54a5417955373b80130ae7c548a6bb",
    "hoppscotch": "1acb8a3a7581e4db32ba0d529170c4669a2e1053",
}
CLEAN = '''<script setup lang="ts">
const __vizeIntentionalTypeError: number = 1;
</script>

<template>
  <div>{{ __vizeIntentionalTypeError }}</div>
</template>
'''
BROKEN = CLEAN.replace("number = 1;", 'number = "not-a-number";')
EXPECTED = "error:2:7 [TS2322] Type 'string' is not assignable to type 'number'."
ROOT = Path.cwd().resolve()
OUT = Path(os.environ["PACKET_DIR"])
OUT.mkdir(parents=True, exist_ok=True)


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(cwd, *args):
    return subprocess.check_output(["git", "-C", str(cwd), *args])


def run(argv, cwd, destination, timeout=300, observer=None):
    destination.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    timed_out = False
    with (destination / "stdout").open("wb") as stdout:
        with (destination / "stderr").open("wb") as stderr:
            process = subprocess.Popen(
                argv, cwd=cwd, stdout=stdout, stderr=stderr, start_new_session=True
            )
            stop = threading.Event()
            watcher = None
            if observer:
                watcher = threading.Thread(target=observer, args=(stop,))
                watcher.start()
            try:
                returncode = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    returncode = process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    returncode = process.wait()
            finally:
                stop.set()
                if watcher:
                    watcher.join()
    record = {
        "argv": list(map(str, argv)), "cwd": str(cwd), "pid": process.pid,
        "timeoutSeconds": timeout, "timedOut": timed_out, "returncode": returncode,
        "elapsedSeconds": time.monotonic() - started,
        "stdoutSHA256": sha(destination / "stdout"),
        "stderrSHA256": sha(destination / "stderr"),
    }
    save_json(destination / "command.json", record)
    return record


def manifest(tree):
    records = []
    if not tree.exists():
        return records
    for directory, dirs, files in os.walk(tree, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            relative = str(path.relative_to(tree))
            if path.is_symlink():
                item = {"path": relative, "symlink": os.readlink(path)}
                if path.is_file():
                    item.update(targetBytes=path.stat().st_size, targetSHA256=sha(path))
                records.append(item)
            elif path.is_file():
                records.append({"path": relative, "bytes": path.stat().st_size,
                                "sha256": sha(path)})
    return sorted(records, key=lambda record: record["path"])


def snapshot(cache, destination):
    if cache.exists():
        shutil.copytree(cache, destination / "materialized", symlinks=True)
        # Preserve linked source bytes without traversing dependency directories.
        for directory, _, files in os.walk(cache, followlinks=False):
            for name in files:
                source = Path(directory) / name
                if source.is_symlink() and source.is_file():
                    target = destination / "linked-file-bytes" / source.relative_to(cache)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
    save_json(destination / "materialized-manifest.json", manifest(cache))


def observe_native_exec(stop, trace, destination, corsa, direct):
    """Copy the ephemeral program during the declared native exec observer pause."""
    records = []
    seen = set()
    position = 0
    pending = ""
    try:
        while True:
            if trace.exists():
                with trace.open() as stream:
                    stream.seek(position)
                    pending += stream.read()
                    position = stream.tell()
                lines = pending.split("\n")
                pending = lines.pop()
                for line in lines:
                    if "execve(" not in line or '"--checkers"' not in line:
                        continue
                    match = re.search(r'"--project", "([^"]+)"', line)
                    if not match or match[1] in seen:
                        continue
                    config = Path(match[1])
                    if "batch-installed-" not in str(config):
                        continue
                    seen.add(str(config))
                    target = destination / str(len(records))
                    target.mkdir(parents=True)
                    (target / "whole-native-exec-line").write_text(line + "\n")
                    before = sha(config)
                    snapshot(config.parent, target)
                    record = {"config": str(config), "configSHA256": before,
                              "observedAtMonotonic": time.monotonic()}
                    records.append(record)
                    if direct:
                        argv = [str(corsa), "--checkers", "1", "--pretty", "false",
                                "--project", str(config)]
                        run(argv, config.parent, target / "direct-diagnostics")
                        run([*argv, "--listFilesOnly"], config.parent, target / "effective-roots")
                    record["configUnchangedThroughObservation"] = config.exists() and sha(config) == before
            if stop.is_set():
                break
            stop.wait(0.025)
    except Exception:
        (destination / "observer-error").parent.mkdir(parents=True, exist_ok=True)
        (destination / "observer-error").write_text(traceback.format_exc())
    finally:
        save_json(destination / "live-exec-receipts.json", records)


def authenticate_source():
    assert git(ROOT, "rev-parse", "HEAD").decode().strip() == SOURCE
    records = []
    for item in git(ROOT, "ls-tree", "-rz", SOURCE).split(b"\0"):
        if not item:
            continue
        header, name = item.split(b"\t", 1)
        mode, kind, expected = header.split()
        path = ROOT / os.fsdecode(name)
        if kind != b"blob":
            continue
        content = os.readlink(path).encode() if mode == b"120000" else path.read_bytes()
        observed = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content)
        assert observed.hexdigest() == expected.decode(), str(path)
        records.append({"path": os.fsdecode(name), "gitBlob": expected.decode(),
                        "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    save_json(OUT / "literal-source-custody.json", records)


def installed_peers(project, destination):
    records = []
    current = project
    while True:
        for package in ("typescript", "@typescript/typescript-linux-x64", "vue"):
            candidate = current / "node_modules" / package / "package.json"
            record = {"candidate": str(candidate), "exists": candidate.is_file()}
            if candidate.is_file():
                target = destination / "installed-packages" / str(len(records))
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(candidate, target)
                record.update(realPath=str(candidate.resolve()), sha256=sha(candidate),
                              package=json.loads(candidate.read_bytes()))
            records.append(record)
        if current.parent == current:
            break
        current = current.parent
    save_json(destination / "nearest-installed-peers.json", records)


def report_diagnostics(command_dir, relative):
    try:
        parsed = json.loads((command_dir / "stdout").read_bytes())
    except (ValueError, OSError):
        return {"parsed": False, "diagnostics": None}
    file = next((file for file in parsed.get("files", [])
                 if file.get("file", "").replace("\\", "/") == relative), None)
    return {"parsed": True, "diagnostics": None if file is None else file.get("diagnostics"),
            "wholeReport": parsed}


def capture_project(name, pin, vize, corsa, cache):
    project = ROOT / "tests/_fixtures/_git" / name
    destination = OUT / name
    destination.mkdir()
    assert git(project, "rev-parse", "HEAD").decode().strip() == pin
    assert git(project, "status", "--porcelain") == b""
    with (destination / "whole-authored-project.tar").open("wb") as archive:
        subprocess.run(["git", "-C", str(project), "archive", pin], stdout=archive, check=True)
    save_json(destination / "project.json", {"cwd": str(project), "gitPin": pin,
              "archiveSHA256": sha(destination / "whole-authored-project.tar")})
    installed_peers(project, destination)
    relative = f"packages/__vize_intentional_type_error_{name.replace('-', '_')}__.vue"
    authored = project / relative
    assert not authored.exists()
    argv = [str(vize), "check", relative, "--format", "json", "--quiet", "--servers", "1",
            "--corsa-path", str(corsa)]
    if name == "element-plus":
        argv.extend(["--tsconfig", "tsconfig.json"])
    reports = {}
    try:
        for phase, content in (("clean", CLEAN), ("broken", BROKEN), ("repair", CLEAN)):
            authored.write_text(content)
            phase_dir = destination / phase
            phase_dir.mkdir()
            shutil.copyfile(authored, phase_dir / "whole-authored.vue")
            # Exact original argv; strace is an explicitly separate observer process.
            trace_path = phase_dir / "native-ipc.strace"
            trace = ["strace", "-f", "-yy", "-s", "2147483647", "-o", str(trace_path),
                     "-e", "inject=execve:delay_enter=5s",
                     "-e", "trace=execve,openat,read,write,close", *argv]
            command = run(trace, project, phase_dir / "original-command", observer=lambda stop:
                          observe_native_exec(stop, trace_path, phase_dir / "native-exec-live",
                                              corsa, phase == "broken"))
            snapshot(cache, phase_dir)
            reports[phase] = report_diagnostics(phase_dir / "original-command", relative)
            reports[phase]["command"] = command
            if phase != "broken":
                continue
            run([*argv, "--show-virtual-ts"], project, phase_dir / "virtual-source-observer")
            snapshot(cache, phase_dir / "after-supplementary-observers")
    finally:
        authored.unlink(missing_ok=True)
        save_json(destination / "original-negative-reports.json", reports)
        (destination / "post-repair-git-status").write_bytes(git(project, "status", "--porcelain"))
    clean = reports.get("clean", {})
    broken = reports.get("broken", {})
    repair = reports.get("repair", {})
    return {
        "project": name, "pin": pin, "relativeFile": relative,
        "cleanOracle": clean.get("diagnostics") == [],
        "brokenOracle": broken.get("diagnostics") == [EXPECTED],
        "repairOracle": repair.get("wholeReport") == clean.get("wholeReport"),
        "originalDeadlines": all(not report["command"]["timedOut"]
                                 and report["command"]["elapsedSeconds"] < 300
                                 for report in reports.values()),
        "liveCustody": all(any(receipt.get("configUnchangedThroughObservation")
            for receipt in json.loads((destination / phase / "native-exec-live/live-exec-receipts.json").read_text()))
            for phase in ("clean", "broken", "repair")),
    }


def main():
    authenticate_source()
    vize = ROOT / "target/ci/vize"
    corsa = ROOT / "node_modules/@typescript/typescript-linux-x64/lib/tsc"
    assert vize.is_file() and corsa.is_file()
    save_json(OUT / "producers.json", {
        "sourceSHA": SOURCE, "driverSHA": os.environ["PACKET_DRIVER_SHA"],
        "runID": os.environ["GITHUB_RUN_ID"], "vizePath": str(vize), "vizeSHA256": sha(vize),
        "corsaPath": str(corsa), "corsaRealPath": str(corsa.resolve()), "corsaSHA256": sha(corsa),
        "driverSHA256": sha(Path(__file__)), "cleanSourceSHA256": hashlib.sha256(CLEAN.encode()).hexdigest(),
        "brokenSourceSHA256": hashlib.sha256(BROKEN.encode()).hexdigest(),
        "originalRunID": "38111801880", "originalJobID": "114388842079",
    })
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "vize/canon/projects"
    results = [capture_project(name, pin, vize, corsa, cache) for name, pin in PINS.items()]
    save_json(OUT / "original-oracle-verdicts.json", results)
    save_json(OUT / "whole-packet-manifest.json", manifest(OUT))
    print(json.dumps(results, indent=2))
    return 0 if all(all(result[key] for key in (
        "cleanOracle", "brokenOracle", "repairOracle", "originalDeadlines", "liveCustody")) for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
