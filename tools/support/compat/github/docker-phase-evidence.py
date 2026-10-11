"""Opt-in observer; original mandatory tooling command and outcome remain independent."""
import json
import os
from pathlib import Path
import sys
import subprocess
import time

sys.dont_write_bytecode = True

from docker_phase_packets import (IMAGE, checkout_identity, process_ancestry, process_identity, query,
                                 runner_owner, source_identity, template)
from docker_phase_stream import observe, write_json


def capture_directory(root):
    parts = [os.environ.get(key, "") for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB")]
    import re
    if not all(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value) for value in parts):
        raise ValueError("Actual run, attempt and job identity required")
    return root / "target/ci-docker-phase" / "-".join(parts)


def prepare(root):
    directory = capture_directory(root)
    directory.mkdir(parents=True)  # Existing evidence must never be overwritten.
    receipt = {"schemaVersion": 1, "status": "unavailable"}
    try:
        receipt.update({"status": "authenticated", "identity": checkout_identity(root)})
    except Exception as error:
        receipt["failureType"] = type(error).__name__
    write_json(directory / "checkout.json", receipt)
    return 0  # Observation failure must not suppress any original build/test command.


def start(root):
    directory = capture_directory(root)
    started = time.monotonic()
    configuration = {"root": str(root), "schemaVersion": 1}
    if (directory / "configuration.json").exists():
        raise FileExistsError("Prior observer configuration must not be overwritten")
    try:
        checkout = json.loads((directory / "checkout.json").read_text())
        if checkout["status"] != "authenticated":
            raise ValueError("Original clean checkout authentication was unavailable")
        configuration["setupStage"] = "runner-ownership"
        configuration["ancestry"] = process_ancestry(os.getpid())
        configuration["owner"] = runner_owner(os.getpid())
        configuration["setupStage"] = "source-custody"
        configuration.update({"checkout": checkout, "source": source_identity(root, checkout["identity"]),
                              "since": str(time.time_ns() // 1000000000),
                              "workflow": {key: os.environ.get(key) for key in
                                           ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB")}})
        configuration["setupStage"] = "daemon-identity"
        configuration["daemon"] = query(["info", "--format", template({
            "id": ".ID", "cpus": ".NCPU", "memory": ".MemTotal",
            "kernel": ".KernelVersion", "architecture": ".Architecture",
            "os": ".OSType", "storageDriver": ".Driver"})])
        configuration["setupStage"] = "image-identity"
        configuration["image"] = query(["image", "inspect", "--format", template({
            "id": ".Id", "digests": ".RepoDigests", "architecture": ".Architecture", "os": ".Os"}), IMAGE])
        if any(configuration[key]["status"] != "observed" for key in ("daemon", "image")):
            raise ValueError("Actual daemon and pinned image identity unavailable")
        write_json(directory / "configuration.json", configuration)
        configuration["setupStage"] = "event-stream-readiness"
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "observe"],
                                 cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + 2
        while not (directory / "ready.json").exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        if not (directory / "ready.json").exists():
            if child.poll() is None:
                child.terminate()
            raise RuntimeError("Observer readiness unavailable")
        configuration["status"] = "started"
    except Exception as error:
        configuration.update({"status": "unavailable", "failureType": type(error).__name__})
    finally:
        configuration["setupSeconds"] = time.monotonic() - started
        write_json(directory / "configuration.json", configuration)
    return 0  # Observer setup never suppresses the unchanged mandatory command.


def finish(root):
    directory = capture_directory(root)
    started = time.monotonic()
    receipt = {"schemaVersion": 1, "status": "unavailable"}
    try:
        configuration = json.loads((directory / "configuration.json").read_text())
        receipt["configuration"] = configuration
        if configuration["status"] != "started":
            raise ValueError("Observer setup was unavailable")
        ready = json.loads((directory / "ready.json").read_text())
        identity = process_identity(ready["observer"]["pid"])
        for key in ("pid", "startTicks", "exe"):
            if identity[key] != ready["observer"][key]:
                raise ValueError("Observer identity changed; refuse stopping another process")
        (directory / "stop").touch()
        deadline = time.monotonic() + 5
        while not (directory / "stream.json").exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        stream = json.loads((directory / "stream.json").read_text())
        receipt["stream"] = stream
        receipt["lifecycleCoverage"] = "partial" if (any(
            item["lifecycleStatus"] != "complete" for item in stream["phases"]) or
            any(stream["counters"][key] for key in ("refused", "inspectionUnavailable", "inspectionQueueFull"))) else "observed-containers-complete"
        after = source_identity(root, configuration["checkout"]["identity"])
        receipt["sourceAfter"] = after
        for key in ("head", "tree", "cliReceiptSha256", "cliReceipt", "generatedDeclaration", "trackedChanges"):
            if after[key] != configuration["source"][key]:
                raise ValueError("Source or authenticated producer identity changed")
        if stream["status"] != "observed" or stream["counters"]["observed"] == 0:
            raise ValueError("No complete real Docker observation")
        receipt["status"] = "observed"
    except Exception as error:
        receipt["failureType"] = type(error).__name__
    finally:
        receipt["finishSeconds"] = time.monotonic() - started
        write_json(directory / "receipt.json", receipt)
    return 0 if receipt["status"] == "observed" else 1


if __name__ == "__main__":
    root = Path.cwd().resolve()
    command = sys.argv[1]
    if command == "observe":
        observe(capture_directory(root))
    else:
        try:
            result = prepare(root) if command == "prepare" else start(root) if command == "start" else finish(root) if command == "finish" else 1
        except Exception as error:
            print("Docker phase observation unavailable: " + type(error).__name__, file=sys.stderr)
            result = 0 if command in ("prepare", "start") else 1
        sys.exit(result)
