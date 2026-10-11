"""Job-owned passive event stream, with bounded allowlisted inspection only."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

from docker_phase_packets import (ACTIONS, CONTAINER_FIELDS, EVENT_FORMAT, IMAGE,
                                 owned_host, process_identity, project_event, query, template)


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def observe(directory):
    configuration = json.loads((directory / "configuration.json").read_text())
    root = Path(configuration["root"])
    owner = configuration["owner"]
    started = time.monotonic()
    stopped = False
    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    command = ["docker", "events", "--since", configuration["since"],
               "--format", EVENT_FORMAT, "--filter", "type=container",
               "--filter", "label=vize.plugin-sandbox=1"]
    for action in ACTIONS:
        command += ["--filter", "event=" + action]
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    os.set_blocking(child.stdout.fileno(), False)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    identities, futures, ancestry_queries = {}, [], []
    counters = {"received": 0, "observed": 0, "unowned": 0, "refused": 0, "inspectionUnavailable": 0,
                "inspectionQueueFull": 0}
    pool = ThreadPoolExecutor(max_workers=2)
    buffer = b""
    failure = None
    write_json(directory / "ready.json", {"observer": process_identity(os.getpid()),
                                         "docker": process_identity(child.pid)})
    try:
        with (directory / "events.jsonl").open("w") as events:
            while not stopped and not (directory / "stop").exists():
                if child.poll() is not None:
                    raise RuntimeError("Docker event stream ended before owned stop")
                for _key, _mask in selector.select(timeout=0.05):
                    chunk = os.read(child.stdout.fileno(), 16384)
                    if not chunk:
                        continue
                    buffer += chunk
                    if len(buffer) > 32768:
                        raise ValueError("Event projection exceeded finite bound")
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        counters["received"] += 1
                        if counters["received"] > 4096:
                            raise ValueError("Capture exceeded finite received-frame bound")
                        try:
                            event = project_event(json.loads(line))
                        except (ValueError, TypeError):
                            counters["refused"] += 1
                            continue
                        container = event["id"]
                        if container not in identities:
                            try:
                                host = owned_host(int(event["host"]), root, owner, observations=ancestry_queries)
                                identities[container] = {"host": host, "image": event["image"],
                                                         "name": event["name"]}
                            except (OSError, ValueError):
                                counters["unowned"] += 1
                                continue
                        identity = identities[container]
                        if (identity["host"]["pid"] != int(event["host"]) or
                                identity["image"] != event["image"] or identity["name"] != event["name"]):
                            raise ValueError("Container owner or image identity changed")
                        event["receivedMonotonicSeconds"] = time.monotonic()
                        event["hostStartTicks"] = identity["host"]["startTicks"]
                        events.write(json.dumps(event) + "\n")
                        events.flush()
                        counters["observed"] += 1
                        if counters["observed"] > 4096 or len(identities) > 512:
                            raise ValueError("Capture exceeded finite event/container bounds")
                        if event["action"] in ("create", "start"):
                            if sum(not future.done() for _, _, future in futures) >= 4:
                                counters["inspectionQueueFull"] += 1
                            else:
                                futures.append((container, event["timeNano"], pool.submit(
                                    query, ["inspect", "--type=container", "--format",
                                            template(CONTAINER_FIELDS), container], 0.5)))
    except Exception as error:
        failure = type(error).__name__
    finally:
        if buffer:
            failure = "FinalPartialFrame"
        selector.close()
        child.terminate() if child.poll() is None else None
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=1)
        child.stdout.close()
        pool.shutdown(wait=True)
        inspections = []
        for container, stamp, future in futures:
            result = future.result()
            if result["status"] == "observed" and (result["value"].get("id") != container or
                    result["value"].get("image") != configuration["image"]["value"]["id"]):
                result = {"status": "refused", "errorType": "ContainerIdentityMismatch",
                          "durationSeconds": result["durationSeconds"]}
            if result["status"] != "observed":
                counters["inspectionUnavailable"] += 1
            inspections.append({"container": container, "eventTimeNano": stamp, **result})
        content = (directory / "events.jsonl").read_bytes()
        boundaries = {}
        for line in content.decode().splitlines():
            event = json.loads(line)
            boundaries.setdefault(event["id"], {}).setdefault(event["action"], []).append(event["timeNano"])
        phases = []
        for container, events in boundaries.items():
            pairs = {}
            for left, right in (("create", "start"), ("start", "die"), ("die", "destroy")):
                if len(events.get(left, [])) == 1 and len(events.get(right, [])) == 1:
                    duration = events[right][0] - events[left][0]
                    pairs[left + "To" + right.title() + "Nanoseconds"] = duration if duration >= 0 else None
            missing = [phase for phase in ("create", "start", "die", "destroy") if phase not in events]
            repeated = [phase for phase, stamps in events.items() if len(stamps) != 1]
            phases.append({"container": container, "timestamps": events, "observedDurations": pairs,
                           "missingPhases": missing, "repeatedPhases": repeated,
                           "lifecycleStatus": "partial" if missing or repeated else "complete"})
        write_json(directory / "stream.json", {
            "schemaVersion": 1, "status": "observed" if failure is None else "unavailable",
            "failureType": failure, "owner": owner, "image": IMAGE, "counters": counters,
            "containers": identities, "inspections": inspections,
            "events": {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()},
            "durationSeconds": time.monotonic() - started,
            "daemonExitCode": child.returncode,
            "inspectionSeconds": sum(item["durationSeconds"] for item in inspections),
            "ancestryQueries": ancestry_queries,
            "ancestryQuerySeconds": sum(item["durationSeconds"] for item in ancestry_queries),
            "phases": phases,
            "finalPartialFrameBytes": len(buffer),
        })
