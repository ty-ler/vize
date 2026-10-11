"""Private exact-candidate observer; never qualifies or changes a production gate."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time

ROOT = Path.cwd()
OUT = Path(os.environ["RUNNER_TEMP"]) / "native-array-timeout"
OUT.mkdir(exist_ok=True)
shutil.copyfile(__file__, OUT / "observer-driver.py")
SHA = "c395492c78117aae12e764235c85fa2e106a53e3"
LAW = "array_annotations::original_array_vue_keeps_script_and_literal_checks_but_refuses_bound_templates"
ARCHIVE = ROOT / ".artifacts/rust-test-archive"


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + "\n")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def command(name, args, checked=True):
    start = time.monotonic()
    with (OUT / (name + ".stdout.bin")).open("wb") as stdout, (OUT / (name + ".stderr.bin")).open("wb") as stderr:
        process = subprocess.Popen(args, stdout=stdout, stderr=stderr)
        status = process.wait()
    save(name + ".json", {"argv": args, "pid": process.pid, "elapsedSeconds": time.monotonic() - start, "exitCode": status})
    if checked and status:
        raise RuntimeError(f"{name} failed: {status}; complete streams retained")
    return status


assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == SHA
assert not subprocess.check_output(["git", "diff", "--name-only"], text=True).strip()
assert os.environ.get("VIZE_TEST_REQUIRE_TSGO") == "1"
assert "VIZE_TEST_DISABLE_TSGO" not in os.environ
command("verify-original-archive", ["node", "tools/support/compat/github/rust-test-archive.mjs", "verify", str(ARCHIVE / "tests.tar.zst"), str(ARCHIVE / "receipt.json")])
shutil.copyfile(ARCHIVE / "receipt.json", OUT / "original-archive-receipt.json")
save("candidate.json", {"sha": SHA, "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip(), "originalRun": 38109119091, "originalFailedJob": 114381540965, "originalArchiveArtifact": 11690937464, "originalArchiveSha256": digest(ARCHIVE / "tests.tar.zst"), "observerRun": os.environ["GITHUB_RUN_ID"], "observerDriverSha": os.environ["OBSERVER_DRIVER_SHA"], "rustc": subprocess.check_output(["rustc", "-Vv"], text=True), "nextest": subprocess.check_output(["cargo", "nextest", "--version"], text=True), "requireTsgo": "1", "disableTsgo": None})

paths = ["Cargo.lock", "Cargo.toml", ".config/nextest.toml", "crates/vize_canon/tests/native_vue_check.rs", "crates/vize_canon/tests/native_vue_check/array_annotations.rs", "crates/vize_canon/src/corsa_bridge/native_vue.rs", "crates/vize_canon/src/corsa_bridge/bridge.rs", "crates/vize_canon/src/lsp_client/editor_lsp/native_vue.rs", "davinci/vize_l4/tests/fixtures/array-program-checker.json"]
for name in paths:
    destination = OUT / "original-source" / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / name, destination)
save("original-source-sha256.json", {name: digest(ROOT / name) for name in paths})
(ROOT / "target/tmp").mkdir(parents=True, exist_ok=True)
selected = f"package(=vize_canon) & binary(=native_vue_check) & test(={LAW})"
args = ["cargo", "nextest", "list", "--archive-file", str(ARCHIVE / "tests.tar.zst"), "--extract-to", str(ROOT), "--extract-overwrite", "--workspace-remap", str(ROOT), "--profile", "full", "-E", selected, "--message-format", "json"]
command("original-selected-tests", args)
listed = json.loads((OUT / "original-selected-tests.stdout.bin").read_bytes())
suite = listed["rust-suites"]["vize_canon::native_vue_check"]
assert suite["testcases"][LAW]["filter-match"]["status"] == "matches"
original_binary = Path(suite["binary-path"])
shutil.copyfile(original_binary, OUT / "original-native-vue-check.bin")
save("original-binary-sha256.json", {"path": str(original_binary), "sha256": digest(original_binary)})
original_exit = command("original-single-law", ["cargo", "nextest", "run", "--archive-file", str(ARCHIVE / "tests.tar.zst"), "--extract-to", str(ROOT), "--extract-overwrite", "--workspace-remap", str(ROOT), "--profile", "full", "-E", selected, "--no-tests", "fail", "--no-capture"], checked=False)

# Only stderr observer statements are added to integration-test files. Removing
# those exact statements reconstructs each original candidate file byte for byte.
patches = {
    "crates/vize_canon/tests/native_vue_check/array_annotations.rs": [
        ("    block_on(bridge.spawn()).unwrap();", "    eprintln!(\"array-observer stage=spawn:start pid={}\", std::process::id());\n    block_on(bridge.spawn()).unwrap();\n    eprintln!(\"array-observer stage=spawn:end pid={}\", std::process::id());"),
        ("        let checked = block_on(bridge.check_native_vue(observed.admitted().unwrap(), &path));", "        eprintln!(\"array-observer stage=check:start template={template:?} pid={}\", std::process::id());\n        let checked = block_on(bridge.check_native_vue(observed.admitted().unwrap(), &path));\n        eprintln!(\"array-observer stage=check:end template={template:?} error={:?} pid={}\", checked.as_ref().err(), std::process::id());"),
        ("    block_on(bridge.shutdown()).unwrap();", "    eprintln!(\"array-observer stage=shutdown:start pid={}\", std::process::id());\n    block_on(bridge.shutdown()).unwrap();\n    eprintln!(\"array-observer stage=shutdown:end pid={}\", std::process::id());"),
    ],
    "crates/vize_canon/tests/native_vue_check.rs": [
        ("    vize_carton::corsa_resolver::resolve_corsa_executable(", "    let resolved = vize_carton::corsa_resolver::resolve_corsa_executable("),
        ("    .unwrap()\n}\nfn project", "    .unwrap();\n    eprintln!(\"array-observer backend={} pid={}\", resolved.display(), std::process::id());\n    resolved\n}\nfn project"),
    ],
}
for name, replacements in patches.items():
    original = (ROOT / name).read_text()
    modified = original
    for before, after in replacements:
        assert modified.count(before) == 1, (name, before)
        modified = modified.replace(before, after)
    recovered = modified
    for before, after in reversed(replacements):
        recovered = recovered.replace(after, before)
    assert recovered == original
    (ROOT / name).write_text(modified)
command("observer-only-source-diff", ["git", "diff", "--", *patches])
changed = subprocess.check_output(["git", "diff", "--name-only"], text=True).splitlines()
assert sorted(changed) == sorted(patches)
command("build-observer-integration-test", ["cargo", "test", "--locked", "--workspace", "--profile", "ci", "--test", "native_vue_check", "--no-run", "--message-format", "json"])
compiled = [json.loads(line) for line in (OUT / "build-observer-integration-test.stdout.bin").read_text().splitlines() if line.startswith("{")]
binaries = [item["executable"] for item in compiled if item.get("reason") == "compiler-artifact" and item.get("target", {}).get("name") == "native_vue_check" and item.get("executable")]
assert len(binaries) == 1, binaries
binary = Path(binaries[0])
shutil.copyfile(binary, OUT / "observer-native-vue-check.bin")
save("observer-binary-sha256.json", {"path": str(binary), "sha256": digest(binary), "features": [item.get("features") for item in compiled if item.get("executable") == str(binary)]})
os.environ["LD_LIBRARY_PATH"] = str(ROOT / "target/ci/deps") + ":" + os.environ.get("LD_LIBRARY_PATH", "")

stop = threading.Event()
def sample():
    with (OUT / "process-tree.ndjson").open("w") as stream:
        while not stop.wait(0.1):
            output = subprocess.check_output(["ps", "-eo", "pid,ppid,etimes,pcpu,rss,stat,args"], text=True).splitlines()
            rows = [line.split(None, 6) for line in output[1:]]
            owned = {os.getpid()}
            while True:
                expanded = owned | {int(row[0]) for row in rows if int(row[1]) in owned}
                if expanded == owned:
                    break
                owned = expanded
            stream.write(json.dumps({"timeNs": time.time_ns(), "processes": [row for row in rows if int(row[0]) in owned]}) + "\n")

sampler = threading.Thread(target=sample)
sampler.start()
try:
    traced_exit = command("traced-single-law", ["strace", "-ff", "-ttt", "-T", "-yy", "-s", "1048576", "-o", str(OUT / "syscall"), "-e", "trace=process,read,write,recvfrom,sendto,recvmsg,sendmsg", "-e", "read=all", "-e", "write=all", str(binary), LAW, "--exact", "--nocapture"], checked=False)
finally:
    stop.set()
    sampler.join()

stderr = (OUT / "traced-single-law.stderr.bin").read_text(errors="replace")
backend_paths = [line.split("backend=", 1)[1].split(" pid=", 1)[0] for line in stderr.splitlines() if "array-observer backend=" in line]
assert len(set(backend_paths)) == 1, backend_paths
backend = Path(backend_paths[0]).resolve()
shutil.copyfile(backend, OUT / "actual-backend.bin")
save("actual-backend-sha256.json", {"path": str(backend), "sha256": digest(backend)})
save("result.json", {"originalExitCode": original_exit, "tracedObserverExitCode": traced_exit, "limitation": "Single-law observer changes process load and strace adds overhead; a pass does not establish the root cause or qualify a production queue. Original backend/product source and 30s deadline are retained."})
save("complete-capture-sha256.json", {str(p.relative_to(OUT)): digest(p) for p in OUT.rglob("*") if p.is_file()})
print(json.dumps({"originalExitCode": original_exit, "tracedObserverExitCode": traced_exit, "capture": str(OUT)}))
raise SystemExit(original_exit or traced_exit)
