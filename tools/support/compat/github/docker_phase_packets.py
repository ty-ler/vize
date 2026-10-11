"""Finite Docker identities; never request guest arguments, environment or content."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

IMAGE = "node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8"
ACTIONS = ("create", "start", "die", "oom", "destroy")
EVENT_FORMAT = ('{"type":{{json .Type}},"action":{{json .Action}},'
                '"id":{{json .Actor.ID}},"timeNano":{{json .TimeNano}},'
                '"image":{{json (index .Actor.Attributes "image")}},'
                '"name":{{json (index .Actor.Attributes "name")}},'
                '"sandbox":{{json (index .Actor.Attributes "vize.plugin-sandbox")}},'
                '"host":{{json (index .Actor.Attributes "vize.plugin-sandbox.host")}},'
                '"exitCode":{{json (index .Actor.Attributes "exitCode")}}}')
CONTAINER_FIELDS = {
    "id": ".Id", "image": ".Image", "created": ".Created", "pid": ".State.Pid",
    "status": ".State.Status", "started": ".State.StartedAt", "finished": ".State.FinishedAt",
    "exitCode": ".State.ExitCode", "oom": ".State.OOMKilled", "user": ".Config.User",
    "memory": ".HostConfig.Memory", "memorySwap": ".HostConfig.MemorySwap",
    "nanoCpus": ".HostConfig.NanoCpus", "cpuQuota": ".HostConfig.CpuQuota",
    "cpuPeriod": ".HostConfig.CpuPeriod", "pidsLimit": ".HostConfig.PidsLimit",
    "network": ".HostConfig.NetworkMode", "readOnly": ".HostConfig.ReadonlyRootfs",
    "capDrop": ".HostConfig.CapDrop", "securityOpt": ".HostConfig.SecurityOpt",
    "runtime": ".HostConfig.Runtime",
}


def template(fields):
    return "{" + ",".join('"' + key + '":{{json ' + value + "}}" for key, value in fields.items()) + "}"


def query(args, timeout=2):
    started = time.monotonic()
    try:
        result = subprocess.run(["docker"] + args, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=False)
        if result.returncode or len(result.stdout) > 16384:
            return {"status": "unavailable", "exitCode": result.returncode,
                    "durationSeconds": time.monotonic() - started}
        return {"status": "observed", "value": json.loads(result.stdout),
                "durationSeconds": time.monotonic() - started}
    except Exception as error:
        return {"status": "unavailable", "errorType": type(error).__name__,
                "durationSeconds": time.monotonic() - started}


def process_identity(pid, proc=Path("/proc")):
    stat = (proc / str(pid) / "stat").read_text()
    fields = stat[stat.rindex(")") + 2:].split()
    return {"pid": int(pid), "parent": int(fields[1]), "startTicks": int(fields[19]),
            "exe": os.path.basename(os.readlink(proc / str(pid) / "exe"))}


def runner_owner(pid, proc=Path("/proc")):
    for _ in range(64):
        identity = process_identity(pid, proc)
        if identity["exe"] == "Runner.Worker":
            return identity
        pid = identity["parent"]
        if pid <= 1:
            break
    raise ValueError("Actual isolated job worker ancestry is unavailable")


def owned_host(pid, root, owner, proc=Path("/proc")):
    identity = process_identity(pid, proc)
    cwd = (proc / str(pid) / "cwd").resolve(strict=True)
    if cwd != root and root not in cwd.parents:
        raise ValueError("Sandbox host is outside actual checkout")
    if runner_owner(pid, proc) != owner:
        raise ValueError("Sandbox host belongs to another runner job")
    return identity


def project_event(value):
    if not isinstance(value, dict) or value.get("type") != "container" or value.get("action") not in ACTIONS:
        raise ValueError("Unexpected lifecycle event")
    if value.get("sandbox") != "1" or value.get("image") != IMAGE:
        raise ValueError("Unexpected sandbox or image")
    if not re.fullmatch(r"[a-f0-9]{64}", value.get("id", "")):
        raise ValueError("Expected complete physical container identity")
    if not re.fullmatch(r"vize-plugin-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", value.get("name", "")):
        raise ValueError("Unexpected sandbox container name")
    if not re.fullmatch(r"[1-9][0-9]{0,9}", value.get("host", "")):
        raise ValueError("Expected actual sandbox host pid")
    stamp = value.get("timeNano")
    if type(stamp) is not int or stamp <= 0:
        raise ValueError("Expected exact daemon timestamp")
    result = {key: value[key] for key in ("action", "id", "timeNano", "image", "name", "host")}
    exit_code = value.get("exitCode", "")
    if exit_code:
        if not re.fullmatch(r"[0-9]{1,5}", exit_code):
            raise ValueError("Unexpected exit status")
        result["exitCode"] = int(exit_code)
    return result


def checkout_identity(root):
    started = time.monotonic()
    def git(*args):
        return subprocess.check_output(["git"] + list(args), cwd=root).decode().rstrip("\n")
    source = git("rev-parse", "HEAD")
    if source != os.environ.get("GITHUB_SHA") or git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Actual clean checkout differs from workflow identity")
    declaration = root / "npm/native/index.d.ts"
    if declaration.resolve() != declaration or not declaration.is_file():
        raise ValueError("Expected original physical native declaration")
    content = declaration.read_bytes()
    return {"head": source, "tree": git("rev-parse", "HEAD^{tree}"),
            "generatedDeclarationBefore": {"path": "npm/native/index.d.ts", "bytes": len(content),
                                           "mode": declaration.stat().st_mode,
                                           "sha256": hashlib.sha256(content).hexdigest()},
            "durationSeconds": time.monotonic() - started}


def source_identity(root, checkout):
    started = time.monotonic()
    def git(*args):
        return subprocess.check_output(["git"] + list(args), cwd=root).decode().rstrip("\n")
    receipt = root / "target/ci/vize.differential-build.json"
    content = receipt.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    expected = os.environ.get("VIZE_SOURCE_CLI_RECEIPT_SHA256")
    if not expected or digest != expected:
        raise ValueError("Authenticated same-run producer receipt is required")
    source = git("rev-parse", "HEAD")
    if source != os.environ.get("GITHUB_SHA") or source != checkout["head"] or git("rev-parse", "HEAD^{tree}") != checkout["tree"]:
        raise ValueError("Actual source differs from authenticated clean checkout")
    # Existing native builds regenerate this declaration; every other tracked/staged delta refuses.
    changes = git("status", "--porcelain", "--untracked-files=no").splitlines()
    if changes not in ([], [" M npm/native/index.d.ts"]):
        raise ValueError("Unreviewed source or staged declaration mutation")
    declaration = root / "npm/native/index.d.ts"
    if declaration.resolve() != declaration or not declaration.is_file():
        raise ValueError("Native generated declaration is not a physical source file")
    generated = declaration.read_bytes()
    if declaration.stat().st_mode != checkout["generatedDeclarationBefore"]["mode"]:
        raise ValueError("Generated declaration file mode changed")
    return {"head": source, "tree": git("rev-parse", "HEAD^{tree}"),
            "cliReceiptSha256": digest, "cliReceipt": json.loads(content),
            "generatedDeclaration": {"path": "npm/native/index.d.ts", "bytes": len(generated),
                                     "mode": declaration.stat().st_mode,
                                     "sha256": hashlib.sha256(generated).hexdigest()},
            "trackedChanges": changes,
            "bytesHashed": len(content), "durationSeconds": time.monotonic() - started}
