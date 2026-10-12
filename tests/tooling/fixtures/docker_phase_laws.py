"""Author real process and failure controls without launching a guest or altering Docker."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/support/compat/github"))
sys.dont_write_bytecode = True
import docker_phase_packets as packets
import docker_phase_stream as stream

spec = importlib.util.spec_from_file_location("capture", ROOT / "tools/support/compat/github/docker-phase-evidence.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def event():
    return {"type": "container", "action": "create", "id": "a" * 64,
            "image": packets.IMAGE, "name": "vize-plugin-12345678-1234-1234-1234-123456789abc",
            "sandbox": "1", "host": "22", "timeNano": 1234567891234567890, "exitCode": ""}


def process(proc, pid, parent, ticks, exe, cwd):
    directory = proc / str(pid)
    directory.mkdir()
    fields = ["S", str(parent)] + ["0"] * 17 + [str(ticks)]
    (directory / "stat").write_text(str(pid) + " (worker name) " + " ".join(fields))
    (directory / "exe").symlink_to("/physical/" + exe)
    (directory / "cwd").symlink_to(cwd)


class DockerPhaseLaws(unittest.TestCase):
    def test_event_projection_keeps_nanoseconds_and_refuses_unsupported_authority(self):
        value = event()
        value.update({"environment": "private-control", "command": "private-control"})
        projected = packets.project_event(value)
        self.assertEqual(projected["timeNano"], 1234567891234567890)
        self.assertEqual(set(projected), {"action", "id", "timeNano", "image", "name", "host"})
        for key, replacement in (("sandbox", "0"), ("image", "node:latest"), ("host", "secret"),
                                 ("id", "abc"), ("name", "foreign"), ("action", "exec_start"),
                                 ("timeNano", 1.5), ("exitCode", "private-control")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                packets.project_event({**event(), key: replacement})

    def test_same_runner_worker_and_checkout_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            proc = root / "proc"
            proc.mkdir()
            checkout = root / "checkout"
            checkout.mkdir()
            foreign = root / "foreign"
            foreign.mkdir()
            process(proc, 1, 0, 1, "init", checkout)
            process(proc, 10, 1, 101, "Runner.Worker", checkout)
            process(proc, 22, 10, 202, "node", checkout)
            process(proc, 23, 10, 203, "node", foreign)
            process(proc, 30, 1, 301, "Runner.Worker", checkout)
            process(proc, 31, 30, 302, "node", checkout)
            owner = packets.runner_owner(22, proc)
            ancestry = packets.process_ancestry(22, proc)
            self.assertEqual([entry["pid"] for entry in ancestry], [22, 10, 1])
            self.assertEqual(set(ancestry[0]), {"pid", "parent", "startTicks", "exe", "comm", "uid"})
            self.assertEqual(packets.owned_host(22, checkout, owner, proc)["startTicks"], 202)
            for pid in (23, 31):
                with self.assertRaises(ValueError):
                    packets.owned_host(pid, checkout, owner, proc)

    def test_queries_are_bounded_and_do_not_retain_docker_errors(self):
        with patch.object(packets.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 2)):
            result = packets.query(["info"])
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["errorType"], "TimeoutExpired")
        self.assertNotIn("stderr", result)
        bad = subprocess.CompletedProcess([], 1, b"private-control", b"private-control")
        with patch.object(packets.subprocess, "run", return_value=bad):
            self.assertEqual(set(packets.query(["info"])), {"status", "exitCode", "durationSeconds"})
        for forbidden in (".Config.Env", ".Config.Cmd", ".Config.Entrypoint", ".Mounts", ".Args"):
            self.assertNotIn(forbidden, packets.template(packets.CONTAINER_FIELDS))
        self.assertNotIn("json .Actor.Attributes", packets.EVENT_FORMAT)

    def test_unavailable_setup_does_not_suppress_original_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "tooling"}
            ancestry = [{"pid": 22, "parent": 1, "startTicks": 20, "exe": "python3"},
                        {"pid": 1, "parent": 0, "startTicks": 1, "exe": "unreviewed-runner"}]
            with patch.dict(os.environ, env), \
                    patch.object(capture, "process_ancestry", return_value=ancestry), \
                    patch.object(capture, "source_identity", return_value={"head": "authenticated"}), \
                    patch.object(capture, "tooling_selection", return_value={"mandatoryDockerTests": []}), \
                    patch.object(capture, "runner_owner", side_effect=ValueError("private-control")):
                directory = capture.capture_directory(root)
                directory.mkdir(parents=True)
                stream.write_json(directory / "checkout.json", {"status": "authenticated", "identity": {}})
                self.assertEqual(capture.start(root, "1/1"), 0)
                record = json.loads((capture.capture_directory(root) / "configuration.json").read_text())
                self.assertEqual(record["failureType"], "ValueError")
                self.assertEqual(record["setupStage"], "runner-ownership")
                self.assertEqual(record["ancestry"], ancestry)
                self.assertNotIn("private-control", json.dumps(record))
                marker = root / "original-once"
                subprocess.run([sys.executable, "-c", "from pathlib import Path; Path('original-once').write_text('1')"],
                               cwd=root, check=True)
                self.assertEqual(marker.read_text(), "1")
                self.assertEqual(capture.finish(root), 1)

    def test_exact_proc_fallback_authenticates_birth_and_refuses_partial_role(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            process(root, 1, 0, 1, "init", root)
            process(root, 10, 1, 101, "Runner.Worker", root)
            process(root, 22, 10, 202, "node", root)
            original = packets.os.readlink
            def protected(path, *args, **kwargs):
                if Path(path) == root / "10/exe":
                    raise PermissionError("private-control")
                return original(path, *args, **kwargs)
            result = subprocess.CompletedProcess([], 0, b"/physical/Runner.Worker\n", b"private-control")
            observations = []
            with patch.object(packets.os, "readlink", side_effect=protected), \
                    patch.object(packets.subprocess, "run", return_value=result) as reader:
                self.assertEqual(packets.runner_owner(22, root, observations)["startTicks"], 101)
                reader.assert_called_once_with(
                    ["/usr/bin/sudo", "-n", "/usr/bin/readlink", "--", str(root / "10/exe")],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1, check=False)
                with self.assertRaises(PermissionError):
                    packets.process_identity(10, root)
            self.assertEqual(observations[0]["status"], "observed")
            self.assertNotIn("private-control", json.dumps(observations))
            def upper_gap(path, *args, **kwargs):
                if Path(path) == root / "1/exe":
                    raise PermissionError("private-control")
                return original(path, *args, **kwargs)
            with patch.object(packets.os, "readlink", side_effect=upper_gap), \
                    patch.object(packets.subprocess, "run", side_effect=subprocess.TimeoutExpired("reader", 1)):
                chain = packets.process_ancestry(22, root, privileged=True, retain_gaps=True)
                self.assertEqual(chain[-1]["status"], "unavailable")
                self.assertEqual(packets.runner_owner(22, root)["exe"], "Runner.Worker")
            bad = subprocess.CompletedProcess([], 1, b"private-control", b"private-control")
            with patch.object(packets.os, "readlink", side_effect=protected), \
                    patch.object(packets.subprocess, "run", return_value=bad):
                chain = packets.process_ancestry(22, root, privileged=True, retain_gaps=True)
                self.assertEqual([item["pid"] for item in chain], [22, 10])
                self.assertEqual(chain[-1]["status"], "unavailable")
                self.assertEqual(chain[-1]["startTicks"], 101)
                with self.assertRaises(ValueError):
                    packets.runner_owner(22, root)
            with patch.object(packets.os, "readlink", side_effect=protected), \
                    patch.object(packets.subprocess, "run", return_value=subprocess.CompletedProcess(
                        [], 0, b"/physical/Runner.Listener\n", b"")), self.assertRaises(ValueError):
                packets.runner_owner(22, root)
            for output in (b"/physical/Runner.Worker\n", b"/physical/Runner.Listener\n"):
                def drift(_args, **_kwargs):
                    (root / "10/stat").write_text("10 (worker name) S 1 " + "0 " * 17 + "102")
                    return subprocess.CompletedProcess([], 0, output, b"")
                with patch.object(packets.os, "readlink", side_effect=protected), \
                        patch.object(packets.subprocess, "run", side_effect=drift), self.assertRaises(ValueError):
                    packets.process_identity(10, root, privileged=True)
                (root / "10/stat").write_text("10 (worker name) S 1 " + "0 " * 17 + "101")

    def test_exact_proc_fallback_has_finite_output_and_retains_every_gap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            process(root, 1, 0, 1, "init", root)
            for output in (b"relative\n", b"/two\nlines\n", b"x" * 4097, b"/physical/Runner.Worker", b"\xff\n"):
                observations = []
                result = subprocess.CompletedProcess([], 0, output, b"private-control")
                with patch.object(packets.os, "readlink", side_effect=PermissionError("private-control")), \
                        patch.object(packets.subprocess, "run", return_value=result):
                    chain = packets.process_ancestry(1, root, privileged=True, retain_gaps=True, observations=observations)
                self.assertEqual(chain[-1]["status"], "unavailable")
                self.assertEqual(observations[-1]["status"], "unavailable")
                self.assertNotIn("private-control", json.dumps(chain + observations))
            with patch.object(packets.os, "readlink", side_effect=PermissionError), \
                    patch.object(packets.subprocess, "run", side_effect=subprocess.TimeoutExpired("reader", 1)):
                chain = packets.process_ancestry(1, root, privileged=True, retain_gaps=True)
            self.assertEqual(chain[-1]["failureType"], "TimeoutExpired")
            with patch.object(packets.os, "readlink", side_effect=PermissionError), \
                    patch.object(packets.subprocess, "run") as reader, self.assertRaises(ValueError):
                packets.process_identity(1, root, privileged=True, observations=[{}] * 4096)
            reader.assert_not_called()
            (root / "1/stat").write_text("1 (truncated) S")
            self.assertEqual(packets.process_ancestry(1, root, retain_gaps=True)[-1],
                             {"pid": 1, "status": "unavailable", "failureType": "ValueError"})

    def test_existing_evidence_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "tooling"}
            clean_env = {key: value for key, value in os.environ.items() if key != "VIZE_SOURCE_CLI_USE_RECEIPT_SHA256"}
            with patch.dict(os.environ, {**clean_env, **env}, clear=True):
                directory = capture.capture_directory(root)
                directory.mkdir(parents=True)
                witness = directory / "configuration.json"
                witness.write_text('"preserved"')
                with self.assertRaises(FileExistsError):
                    capture.start(root, "1/1")
                self.assertEqual(witness.read_text(), '"preserved"')

    def test_finish_refuses_reused_observer_pid_without_signalling_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "tooling"}
            with patch.dict(os.environ, env):
                directory = capture.capture_directory(root)
                directory.mkdir(parents=True)
                stream.write_json(directory / "configuration.json", {"status": "started"})
                stream.write_json(directory / "ready.json", {"observer": {"pid": 3, "startTicks": 10, "exe": "python3"}})
                with patch.object(capture, "process_identity", return_value={"pid": 3, "startTicks": 11, "exe": "python3"}):
                    self.assertEqual(capture.finish(root), 1)
                self.assertFalse((directory / "stop").exists())

    def observed_stream(self, partial="", omit=()):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            directory = root / "capture"
            directory.mkdir()
            image = "sha256:" + "b" * 64
            stream.write_json(directory / "configuration.json", {
                "root": str(root), "owner": {"pid": 1}, "since": "123",
                "image": {"value": {"id": image}}})
            binary = root / "docker"
            records = [{**event(), "action": action, "timeNano": 1000000000 + index * 100000000}
                       for index, action in enumerate(("create", "start", "die", "destroy")) if action not in omit]
            content = "".join(json.dumps(value) + "\n" for value in records) + partial
            binary.write_text("#!" + sys.executable + "\nimport sys, time\n" +
                              "sys.stdout.write(" + repr(content) + "); sys.stdout.flush()\n" +
                              "time.sleep(10)\n")
            binary.chmod(0o755)
            def await_events():
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    witness = directory / "events.jsonl"
                    if witness.exists() and len(witness.read_text().splitlines()) == len(records):
                        break
                    time.sleep(0.01)
                (directory / "stop").touch()
            waiter = threading.Thread(target=await_events)
            waiter.start()
            def inspect(_args, _timeout):
                return {"status": "observed", "durationSeconds": 0.001,
                        "value": {"id": "a" * 64, "image": image}}
            with patch.dict(os.environ, {"PATH": str(root) + os.pathsep + os.environ["PATH"]}), \
                    patch.object(stream, "owned_host", return_value={"pid": 22, "startTicks": 20}), \
                    patch.object(stream, "process_identity", return_value={"pid": 3, "startTicks": 1}), \
                    patch.object(stream, "query", side_effect=inspect):
                stream.observe(directory)
            waiter.join()
            record = json.loads((directory / "stream.json").read_text())
            return record

    def test_actual_projected_stream_preserves_complete_lifecycle_and_physical_inspection(self):
            record = self.observed_stream()
            self.assertEqual(record["status"], "observed")
            self.assertEqual(record["counters"]["observed"], 4)
            self.assertEqual(record["counters"]["inspectionUnavailable"], 0)
            self.assertEqual(len(record["inspections"]), 2)
            phases = record["phases"][0]["observedDurations"]
            self.assertEqual(phases, {"createToStartNanoseconds": 100000000,
                                      "startToDieNanoseconds": 100000000,
                                      "dieToDestroyNanoseconds": 100000000})
            self.assertEqual(record["phases"][0]["lifecycleStatus"], "complete")

    def test_final_partial_frame_and_missing_stage_remain_refusals(self):
        record = self.observed_stream(partial='{"private-control":')
        self.assertEqual(record["status"], "unavailable")
        self.assertEqual(record["failureType"], "FinalPartialFrame")
        self.assertEqual(record["finalPartialFrameBytes"], 19)
        self.assertNotIn("private-control", json.dumps(record))
        missing = self.observed_stream(omit=("start",))
        phase = missing["phases"][0]
        self.assertEqual(phase["lifecycleStatus"], "partial")
        self.assertEqual(phase["missingPhases"], ["start"])
        self.assertEqual(phase["observedDurations"], {"dieToDestroyNanoseconds": 100000000})

    def test_whole_source_and_same_run_receipt_refuse_substitution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            source = root / "law"
            source.write_text("frozen source")
            declaration = root / "npm/native/index.d.ts"
            declaration.parent.mkdir(parents=True)
            declaration.write_text("original native declaration")
            helper = root / "tools/support/compat/github"
            helper.mkdir(parents=True)
            for name in ("docker-phase-evidence.py", "docker_phase_packets.py", "docker_phase_stream.py"):
                (helper / name).write_bytes((ROOT / "tools/support/compat/github" / name).read_bytes())
            subprocess.run(["git", "add", "law", "npm/native/index.d.ts", "tools"], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Law", "-c", "user.email=law@example.invalid",
                            "commit", "--quiet", "-m", "law"], cwd=root, check=True)
            head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip()
            import hashlib
            members = []
            for name, data, mode in (("target/ci/vize", b"inert cli", 0o755),
                                     ("target/ci/vize.differential-build.json", b'{"source":"frozen"}', 0o644),
                                     ("target/ci/examples/cli_build_result_oracle", b"inert oracle", 0o755)):
                member = root / name
                member.parent.mkdir(parents=True, exist_ok=True)
                member.write_bytes(data)
                member.chmod(mode)
                members.append({"path": name, "bytes": len(data), "mode": mode,
                                "sha256": hashlib.sha256(data).hexdigest()})
            receipt = root / "target/ci/vize.source-build.json"
            receipt.write_text(json.dumps({"identity": {"sourceRevision": head,
                "sourceTree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=root).decode().strip(),
                "runId": "123", "runAttempt": "1"}, "members": members}))
            env = {"GITHUB_SHA": head, "VIZE_SOURCE_CLI_RECEIPT_SHA256": hashlib.sha256(receipt.read_bytes()).hexdigest(),
                   "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "tooling"}
            with patch.dict(os.environ, env):
                subprocess.run([sys.executable, str(helper / "docker-phase-evidence.py"), "prepare"],
                               cwd=root, check=True)
                self.assertFalse((helper / "__pycache__").exists())
                self.assertEqual(subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=root).decode(),
                                 "target/ci-docker-phase/123-1-tooling/checkout.json\n" +
                                 "target/ci/examples/cli_build_result_oracle\ntarget/ci/vize\n" +
                                 "target/ci/vize.differential-build.json\ntarget/ci/vize.source-build.json\n")
                checkout = packets.checkout_identity(root)
                self.assertEqual(packets.source_identity(root, checkout)["head"], head)
                declaration.write_text("actual generated declaration")
                self.assertEqual(packets.source_identity(root, checkout)["trackedChanges"], [" M npm/native/index.d.ts"])
                subprocess.run(["git", "add", "npm/native/index.d.ts"], cwd=root, check=True)
                with self.assertRaises(ValueError):
                    packets.source_identity(root, checkout)
                subprocess.run(["git", "restore", "--staged", "npm/native/index.d.ts"], cwd=root, check=True)
                source.write_text("substituted source")
                with self.assertRaises(ValueError):
                    packets.source_identity(root, checkout)
                source.write_text("frozen source")
                receipt.write_text('{"source":"substitution"}')
                with self.assertRaises(ValueError):
                    packets.source_identity(root, checkout)


if __name__ == "__main__":
    unittest.main()
