"""Passive observation of the already launched receipted LSP and descendants."""

import hashlib
import json
import os
from pathlib import Path
import re
import select
import sys
import time


def process(pid):
    stat = Path(f"/proc/{pid}/stat").read_text()
    fields = stat[stat.rindex(")") + 2:].split()
    return {"pid": pid, "parentPid": int(fields[1]), "startTicks": fields[19],
            "state": fields[0], "rssKiB": int(fields[21]) * os.sysconf("SC_PAGE_SIZE") // 1024,
            "userTicks": int(fields[11]), "systemTicks": int(fields[12])}


def main():
    expected_binary, destination = str(Path(sys.argv[1]).resolve()), Path(sys.argv[2])
    expected_digest = hashlib.file_digest(open(expected_binary, "rb"), "sha256").hexdigest()
    known = {}
    executables = {}
    root = None
    deadline = time.monotonic() + 350
    written = 0
    failure = None
    peak_physical_rss = 0
    with destination.open("x") as output:
        def emit(value):
            nonlocal written
            line = json.dumps(value, separators=(",", ":")) + "\n"
            written += len(line.encode())
            if written > 64 * 1024 * 1024:
                raise ValueError("finite raw sample quota exceeded")
            output.write(line)
            output.flush()

        emit({"kind": "start", "wallNs": str(time.time_ns()), "expectedBinary": expected_binary,
              "expectedSha256": expected_digest, "intervalMs": 50,
              "clock": "CLOCK_MONOTONIC", "ns": str(time.monotonic_ns())})
        try:
            while True:
                started = time.monotonic()
                if started > deadline:
                    raise ValueError("finite observer deadline exceeded")
                table = {}
                for entry in Path("/proc").iterdir():
                    if not entry.name.isdecimal():
                        continue
                    pid = int(entry.name)
                    try:
                        row = process(pid)
                        table[pid] = row
                        if root is None and Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")[:2] == [expected_binary.encode(), b"lsp"]:
                            executable = os.readlink(f"/proc/{pid}/exe")
                            if executable != expected_binary:
                                raise ValueError("exact LSP launch changed executable")
                            root = (pid, row["startTicks"])
                            known[pid] = row["startTicks"]
                    except (FileNotFoundError, ProcessLookupError, PermissionError):
                        continue
                if root and root[0] in table and table[root[0]]["startTicks"] != root[1]:
                    raise ValueError("LSP PID was reused")
                selected = {pid for pid, ticks in known.items()
                            if pid in table and table[pid]["startTicks"] == ticks}
                while True:
                    children = {pid for pid, row in table.items() if row["parentPid"] in selected}
                    if children <= selected:
                        break
                    selected.update(children)
                members = []
                for pid in sorted(selected):
                    row = table[pid]
                    known[pid] = row["startTicks"]
                    if row["state"] == "Z":
                        continue
                    key = (pid, row["startTicks"])
                    try:
                        executable = os.readlink(f"/proc/{pid}/exe")
                        if key not in executables:
                            with open(f"/proc/{pid}/exe", "rb") as binary:
                                digest = hashlib.file_digest(binary, "sha256").hexdigest()
                            executables[key] = (executable, digest)
                        if executable != executables[key][0]:
                            raise ValueError("observed executable changed")
                        if root and pid == root[0] and executables[key][1] != expected_digest:
                            raise ValueError("actual parent ELF digest differs from source receipt")
                        smaps = Path(f"/proc/{pid}/smaps_rollup").read_text()
                        memory = {line.split(":", 1)[0]: int(line.split()[1])
                                  for line in smaps.splitlines() if ":" in line and line.split()[1].isdigit()}
                    except (FileNotFoundError, ProcessLookupError):
                        continue
                    members.append({**row, "executable": executable,
                                    "executableSha256": executables[key][1], "smapsKiB": memory})
                    if root and pid == root[0] and memory["Rss"] > peak_physical_rss:
                        peak_physical_rss = memory["Rss"]
                        mappings = []
                        try:
                            for line in Path(f"/proc/{pid}/smaps").read_text().splitlines():
                                if re.match(r"^[0-9a-f]+-[0-9a-f]+ ", line):
                                    header = line.split(maxsplit=5)
                                    mappings.append({"range": header[0], "permissions": header[1],
                                                     "offset": header[2], "device": header[3],
                                                     "inode": header[4], "path": header[5] if len(header) == 6 else ""})
                                elif mappings and ":" in line:
                                    field = line.split(":", 1)[0]
                                    if field in {"Size", "Rss", "Pss", "Anonymous", "AnonHugePages",
                                                 "Private_Dirty", "Private_Clean", "Shared_Clean", "Shared_Dirty"}:
                                        mappings[-1][field] = int(line.split()[1])
                            emit({"kind": "maps", "wallNs": str(time.time_ns()),
                                  "ns": str(time.monotonic_ns()), "root": root,
                                  "triggerRssKiB": peak_physical_rss, "mappings": mappings})
                        except (FileNotFoundError, ProcessLookupError):
                            pass
                emit({"kind": "sample", "wallNs": str(time.time_ns()), "ns": str(time.monotonic_ns()), "root": root,
                      "members": members, "scanMs": (time.monotonic() - started) * 1000})
                if select.select([sys.stdin], [], [], 0)[0]:
                    if sys.stdin.readline().strip() != "stop":
                        raise ValueError("explicit stop signal is required")
                    if root is None:
                        raise ValueError("actual exact LSP launch was never observed")
                    if members:
                        raise ValueError("live original server descendants remain after test exit")
                    break
                time.sleep(max(0, 0.05 - (time.monotonic() - started)))
        except Exception as error:
            failure = str(error)
        emit({"kind": "finish", "wallNs": str(time.time_ns()), "failure": failure, "root": root,
              "observedProcesses": list(known.items()), "ns": str(time.monotonic_ns()),
              "limits": "50ms sampled RSS/PSS; short-lived processes can be missed; passive observer does not kill, collect or trim"})
    if failure:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
