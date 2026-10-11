import hashlib
import json
import os
import pathlib
import subprocess

root = pathlib.Path.cwd()
output = root / "target/app-e2e-logs/vuefes-scope"
output.mkdir(parents=True, exist_ok=True)
custody = json.loads((output / "original-source-custody.json").read_text())
H = custody["originalSourceH"]
pin = custody["upstreamPin"]
fixture = root / "tests/_fixtures/_git/vuefes-2025"
actual_head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
actual_pin = subprocess.check_output(["git", "-C", str(fixture), "rev-parse", "HEAD"], text=True).strip()
records = []
for pattern in ("npm/native/*.node", "target/ci/vize", "tests/_fixtures/_git/vuefes-2025/app/components/**/VFHeading.vue", "tests/_fixtures/_git/vuefes-2025/app/assets/styles/main.css"):
    for file in root.glob(pattern):
        if file.is_file():
            raw = file.read_bytes()
            records.append({"path": str(file.relative_to(root)), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
            if file.suffix != ".node" and file.name != "vize":
                (output / file.name).write_bytes(raw)
(output / "actual-producer-identity.json").write_text(json.dumps({
    "originalSourceH": H, "actualHead": actual_head, "expectedPin": pin,
    "actualPin": actual_pin, "files": records,
}, indent=2) + "\n")

changed = []
post_records = []
for original in custody["producerFiles"]:
    relative = original["path"]
    file = root / relative
    raw = None
    if file.exists() or file.is_symlink():
        raw = os.readlink(file).encode() if original["mode"] == "120000" else file.read_bytes()
    sha = hashlib.sha256(raw).hexdigest() if raw is not None else None
    post_records.append({"path": relative, "bytes": len(raw) if raw is not None else None, "sha256": sha})
    if sha == original["sha256"]:
        continue
    before = subprocess.check_output(["git", "show", f"{H}:{relative}"])
    assert hashlib.sha256(before).hexdigest() == original["sha256"], relative
    target = output / "source-delta" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(str(target) + ".original").write_bytes(before)
    if raw is not None:
        pathlib.Path(str(target) + ".actual").write_bytes(raw)
    changed.append({"path": relative, "before": original, "after": post_records[-1]})

diff = subprocess.run(["git", "diff", "--binary", "--", "crates", "davinci", "npm", "Cargo.toml", "Cargo.lock", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"], capture_output=True, check=False)
(output / "whole-post-build-source.diff").write_bytes(diff.stdout)
(output / "whole-post-build-source.stderr").write_bytes(diff.stderr)
(output / "whole-post-build-source-identity.json").write_text(json.dumps({
    "originalSourceH": H, "actualHead": actual_head, "files": post_records,
    "changedFiles": changed, "diffExitCode": diff.returncode,
    "wholeDiffSha256": hashlib.sha256(diff.stdout).hexdigest(),
    "sourceNormalizationPerformed": False, "sourceExemptions": [],
}, indent=2) + "\n")

observer_failures = []
for side in ("reference", "candidate"):
    file = output / f"dev-home-{side}.json"
    if not file.exists():
        observer_failures.append({"side": side, "error": "missing full observer packet"})
        continue
    packet = json.loads(file.read_text())
    if not packet.get("vueGraph", {}).get("complete"):
        observer_failures.append({"side": side, "error": "incomplete Vue graph", "graph": packet.get("vueGraph")})
    if not packet.get("html") or not packet.get("headings") or not packet.get("sheets"):
        observer_failures.append({"side": side, "error": "incomplete whole DOM/CSS packet"})
    for response in packet.get("responses", []):
        if "body" not in response:
            observer_failures.append({"side": side, "error": "missing whole response body", "response": response})
(output / "observer-completeness.json").write_text(json.dumps({
    "complete": not observer_failures, "failures": observer_failures,
    "originalVrtVerdictUnchanged": True,
}, indent=2) + "\n")
assert actual_head == H and actual_pin == pin, "source or fixture identity drift"
assert any(row["path"].endswith(".node") for row in records), "missing actual compiled native identity"
assert any(row["path"].endswith("VFHeading.vue") for row in records), "missing literal pinned source"
