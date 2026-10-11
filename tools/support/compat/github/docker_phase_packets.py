"""Finite Docker identities; never request guest arguments, environment or content."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
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


def process_stat(pid, proc):
    if type(pid) is not int or not 0 < pid < 2147483648:
        raise ValueError("Expected one actual numeric process identity")
    stat = (proc / str(pid) / "stat").read_text()
    fields = stat[stat.rindex(")") + 2:].split()
    if len(fields) < 20 or int(stat[:stat.index("(")].strip()) != pid:
        raise ValueError("Incomplete or substituted process stat")
    return {"pid": int(pid), "parent": int(fields[1]), "startTicks": int(fields[19]),
            "comm": stat[stat.index("(") + 1:stat.rindex(")")],
            "uid": (proc / str(pid)).stat().st_uid}


def process_identity(pid, proc=Path("/proc"), privileged=False, observations=None):
    before = process_stat(pid, proc)
    path = proc / str(pid) / "exe"
    try:
        executable = os.readlink(path)
    except PermissionError:
        if not privileged:
            raise
        if observations is not None and len(observations) >= 4096:
            raise ValueError("Exact-proc query evidence exceeded finite bound")
        started = time.monotonic()
        observation = {"pid": int(pid), "method": "sudo-noninteractive-exact-readlink"}
        try:
            result = subprocess.run(["/usr/bin/sudo", "-n", "/usr/bin/readlink", "--", str(path)],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1, check=False)
            observation["exitCode"] = result.returncode
            if result.returncode or not 1 < len(result.stdout) <= 4096 or not result.stdout.endswith(b"\n"):
                raise ValueError("Bounded exact-proc readlink unavailable")
            executable = result.stdout[:-1].decode("utf8")
            if "\n" in executable or not executable.startswith("/"):
                raise ValueError("Unexpected physical executable path")
            observation.update({"status": "observed", "bytes": len(result.stdout),
                                "sha256": hashlib.sha256(result.stdout).hexdigest()})
        except Exception as error:
            observation.update({"status": "unavailable", "failureType": type(error).__name__})
            raise
        finally:
            observation["durationSeconds"] = time.monotonic() - started
            if observations is not None:
                observations.append(observation)
    if process_stat(pid, proc) != before:
        raise ValueError("Process birth or ancestry changed during executable observation")
    return {**before, "exe": os.path.basename(executable)}


def process_ancestry(pid, proc=Path("/proc"), privileged=False, retain_gaps=False, observations=None):
    identities = []
    for _ in range(64):
        try:
            identity = process_identity(pid, proc, privileged, observations)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            if not retain_gaps:
                raise
            try:
                identity = process_stat(pid, proc)
            except (OSError, ValueError):
                identity = {"pid": int(pid)}
            identities.append({**identity, "status": "unavailable", "failureType": type(error).__name__})
            break
        if any(entry["pid"] == identity["pid"] for entry in identities):
            if retain_gaps:
                identities.append({"pid": int(pid), "status": "unavailable", "failureType": "AncestryCycle"})
                return identities
            raise ValueError("Actual process ancestry contains a cycle")
        identities.append(identity)
        pid = identity["parent"]
        if pid <= 0:
            break
    else:
        if retain_gaps:
            identities.append({"pid": int(pid), "status": "unavailable", "failureType": "AncestryDepthBound"})
        else:
            raise ValueError("Actual process ancestry exceeded finite depth")
    return identities


def runner_owner(pid, proc=Path("/proc"), observations=None):
    for identity in process_ancestry(pid, proc, privileged=True, retain_gaps=True, observations=observations):
        if identity.get("exe") == "Runner.Worker" and identity.get("status") != "unavailable":
            return identity
    raise ValueError("Actual isolated job worker ancestry is unavailable")


def owned_host(pid, root, owner, proc=Path("/proc"), observations=None):
    identity = process_identity(pid, proc)
    cwd = (proc / str(pid) / "cwd").resolve(strict=True)
    if cwd != root and root not in cwd.parents:
        raise ValueError("Sandbox host is outside actual checkout")
    if runner_owner(pid, proc, observations) != owner:
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
        return subprocess.check_output(["git", "--no-replace-objects"] + list(args), cwd=root).decode().rstrip("\n")
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


def cli_members(root, producer):
    expected = ("target/ci/vize", "target/ci/vize.differential-build.json",
                "target/ci/examples/cli_build_result_oracle")
    members, differential = [], None
    for name in expected:
        path = root / name
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or path.resolve(strict=True) != path:
            raise ValueError("Expected original physical producer member")
        digest, size, receipt = hashlib.sha256(), 0, bytearray()
        with path.open("rb") as reader:
            while True:
                chunk = reader.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                size += len(chunk)
                if name == expected[1]:
                    receipt.extend(chunk)
        after = path.lstat()
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mode, before.st_mtime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mode, after.st_mtime_ns)):
            raise ValueError("Producer member changed during whole-body observation")
        members.append({"path": name, "bytes": size, "mode": stat.S_IMODE(after.st_mode),
                        "sha256": digest.hexdigest()})
        if receipt:
            differential = json.loads(receipt)
    if members != producer["members"] or [member["mode"] for member in members] != [0o755, 0o644, 0o755]:
        raise ValueError("Whole producer member body, mode or inventory differs")
    return members, differential


def source_identity(root, checkout):
    started = time.monotonic()
    def git(*args):
        return subprocess.check_output(["git", "--no-replace-objects"] + list(args), cwd=root).decode().rstrip("\n")
    receipt = root / "target/ci/vize.source-build.json"
    if not stat.S_ISREG(receipt.lstat().st_mode) or receipt.resolve(strict=True) != receipt or stat.S_IMODE(receipt.stat().st_mode) != 0o644:
        raise ValueError("Expected original physical transport envelope")
    content = receipt.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    expected = os.environ.get("VIZE_SOURCE_CLI_RECEIPT_SHA256")
    if not expected or digest != expected:
        raise ValueError("Authenticated same-run producer receipt is required")
    producer = json.loads(content)
    source = git("rev-parse", "HEAD")
    if source != os.environ.get("GITHUB_SHA") or source != checkout["head"] or git("rev-parse", "HEAD^{tree}") != checkout["tree"]:
        raise ValueError("Actual source differs from authenticated clean checkout")
    identity = producer["identity"]
    if (identity["sourceRevision"] != source or identity["sourceTree"] != checkout["tree"] or
            identity["runId"] != os.environ.get("GITHUB_RUN_ID") or
            identity["runAttempt"] != os.environ.get("GITHUB_RUN_ATTEMPT")):
        raise ValueError("Actual transport source or run differs")
    members, differential = cli_members(root, producer)
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
            "cliReceiptSha256": digest, "cliReceipt": producer, "cliMembers": members,
            "differentialReceipt": differential,
            "generatedDeclaration": {"path": "npm/native/index.d.ts", "bytes": len(generated),
                                     "mode": declaration.stat().st_mode,
                                     "sha256": hashlib.sha256(generated).hexdigest()},
            "trackedChanges": changes,
            "bytesHashed": len(content) + len(generated) + sum(member["bytes"] for member in members),
            "durationSeconds": time.monotonic() - started}
