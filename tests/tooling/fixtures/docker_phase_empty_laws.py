"""Empty observations are records, never successful lifecycle evidence."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/support/compat/github"))
spec = importlib.util.spec_from_file_location("capture", ROOT / "tools/support/compat/github/docker-phase-evidence.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def empty_stream():
    return {"status": "observed", "failureType": None, "finalPartialFrameBytes": 0,
            "counters": {"received": 0, "observed": 0, "unowned": 0, "refused": 0,
                         "inspectionUnavailable": 0, "inspectionQueueFull": 0},
            "phases": [], "containers": {}, "inspections": [], "events": {"bytes": 0}}


class EmptyObservationLaws(unittest.TestCase):
    def test_zero_is_explicitly_nonqualifying_and_required_consumer_zero_refuses(self):
        self.assertEqual(capture.lifecycle_outcome(empty_stream(), {"mandatoryDockerTests": []}),
                         ("no-eligible-container-observations", "none"))
        with self.assertRaises(ValueError):
            capture.lifecycle_outcome(empty_stream(), {"mandatoryDockerTests": ["required-law"]})

    def test_every_unavailable_refused_partial_overflow_or_inconsistent_zero_stays_red(self):
        records = []
        for name in empty_stream()["counters"]:
            record = empty_stream(); record["counters"][name] = 1; records.append(record)
        for name, value in [("status", "unavailable"), ("failureType", "FinalPartialFrame"),
                            ("finalPartialFrameBytes", 1), ("phases", [{"lifecycleStatus": "partial"}]),
                            ("containers", {"id": {}}), ("inspections", [{}]), ("events", {"bytes": 1})]:
            record = empty_stream(); record[name] = value; records.append(record)
        for value in [-1, True, "0", 4097]:
            record = empty_stream(); record["counters"]["received"] = value; records.append(record)
        record = empty_stream(); record["counters"]["unknown"] = 0; records.append(record)
        for record in records:
            with self.subTest(record=record), self.assertRaises(ValueError):
                capture.lifecycle_outcome(record, {"mandatoryDockerTests": []})

    def test_actual_complete_lifecycle_retains_credit_and_partial_or_refused_does_not(self):
        record = empty_stream()
        record.update({"phases": [{"lifecycleStatus": "complete"}], "containers": {"id": {}},
                       "events": {"bytes": 100}})
        record["counters"].update(received=4, observed=4)
        self.assertEqual(capture.lifecycle_outcome(record, {"mandatoryDockerTests": ["required-law"]}),
                         ("observed", "observed-containers-complete"))
        for mutation in ["partial", "refused", "unavailable"]:
            changed = copy.deepcopy(record)
            if mutation == "partial": changed["phases"][0]["lifecycleStatus"] = "partial"
            elif mutation == "refused": changed["counters"]["refused"] = 1
            else: changed["status"] = "unavailable"
            with self.assertRaises(ValueError):
                capture.lifecycle_outcome(changed, {"mandatoryDockerTests": ["required-law"]})

    def finish_record(self, selection, stream=None, source_changed=False, plan_changed=False, use_changed=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "tooling"}
            source = {key: "original" for key in ("head", "tree", "cliReceiptSha256", "cliReceipt", "cliMembers", "cliConsumerUse",
                      "differentialReceipt", "generatedDeclaration", "trackedChanges")}
            with patch.dict(os.environ, env):
                directory = capture.capture_directory(root); directory.mkdir(parents=True)
                actor = {"pid": 3, "startTicks": 10, "exe": "python3"}
                capture.write_json(directory / "configuration.json", {"status": "started", "source": source,
                    "checkout": {"identity": {}}, "selection": selection})
                capture.write_json(directory / "ready.json", {"observer": actor})
                capture.write_json(directory / "stream.json", stream or empty_stream())
                after = {**source, "tree": "changed"} if source_changed else source
                if use_changed:
                    after = {**source, "cliConsumerUse": "changed"}
                selected = {**selection, "planSha256": "changed"} if plan_changed else selection
                with patch.object(capture, "process_identity", return_value=actor), \
                        patch.object(capture, "source_identity", return_value=after), \
                        patch.object(capture, "tooling_selection", return_value=selected):
                    status = capture.finish(root)
                return status, json.loads((directory / "receipt.json").read_text())

    def test_real_finalizer_writes_explicit_zero_receipt_and_preserves_authentication_failures(self):
        selection = {"shard": "3/4", "mandatoryDockerTests": [], "planSha256": "original"}
        status, receipt = self.finish_record(selection)
        self.assertEqual(status, 0)
        self.assertEqual(receipt["status"], "no-eligible-container-observations")
        self.assertEqual(receipt["lifecycleCoverage"], "none")
        self.assertIs(receipt["lifecycleQualification"], False)
        self.assertEqual(receipt["selectionAfter"], selection)
        for options in [{"source_changed": True}, {"use_changed": True}, {"plan_changed": True},
                        {"stream": {**empty_stream(), "status": "unavailable"}}]:
            status, receipt = self.finish_record(selection, **options)
            self.assertEqual(status, 1)
            self.assertEqual(receipt["status"], "unavailable")
            self.assertNotEqual(receipt["lifecycleCoverage"], "observed-containers-complete")
        status, receipt = self.finish_record({**selection, "mandatoryDockerTests": ["required-law"]})
        self.assertEqual(status, 1)
        self.assertEqual(receipt["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
