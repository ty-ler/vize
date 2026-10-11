import hashlib
import json
import os
import pathlib
import shutil
import subprocess

H = "605429c660b328bb03bec5bbfef15961e59fcaf0"
root = pathlib.Path.cwd()
driver = root / ".vuefes-observer"
output = root / "target/app-e2e-logs/vuefes-scope"
output.mkdir(parents=True, exist_ok=True)
assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == H
driver_sha = subprocess.check_output(["git", "-C", str(driver), "rev-parse", "HEAD"], text=True).strip()
test = pathlib.Path("tests/app/vrt/vuefes.spec.ts")
original = subprocess.check_output(["git", "show", f"{H}:{test}"])
assert (root / test).read_bytes() == original
records = []
for entry in subprocess.check_output(["git", "ls-files", "--stage", "-z"]).decode().split("\0"):
    if not entry:
        continue
    metadata, path = entry.split("\t", 1)
    mode, oid, stage = metadata.split()
    if not (path.startswith(("crates/", "davinci/", "npm/")) or path in (
        str(test), "tests/_helpers/visual-parity.ts", "tests/_helpers/apps.ts",
        ".github/actions/app-e2e-row/action.yml", "tools/commands/ci/github/app-e2e-plan.rs",
        "Cargo.toml", "Cargo.lock", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    )):
        continue
    assert stage == "0" and mode != "160000", path
    file = root / path
    actual = os.readlink(file).encode() if mode == "120000" else file.read_bytes()
    actual_oid = hashlib.sha1(f"blob {len(actual)}\0".encode() + actual).hexdigest()
    assert actual_oid == oid, path
    records.append({"path": path, "mode": mode, "gitBlob": oid, "bytes": len(actual), "sha256": hashlib.sha256(actual).hexdigest()})

helper_path = pathlib.Path("tools/support/ci/vuefes-scope-observer.ts")
helper = (driver / helper_path).read_bytes()
assert not (root / helper_path).exists()
(root / helper_path).parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(driver / helper_path, root / helper_path)
before_setup = "    await Promise.all([setupPage(referencePage), setupPage(candidatePage)]);"
before_assert = "    await expectVisualParity(referencePage, candidatePage, {"
text = original.decode()
assert text.count(before_setup) == text.count(before_assert) == 1
addition_import = 'import { captureVuefesPage, observeVuefesResponses } from "../../../tools/support/ci/vuefes-scope-observer.ts";\n'
addition_setup = "    const referenceResponses = observeVuefesResponses(referencePage);\n    const candidateResponses = observeVuefesResponses(candidatePage);\n\n"
addition_capture = "    await Promise.all([\n      captureVuefesPage(referencePage, `${mode}-${route.name}-reference`, referenceResponses),\n      captureVuefesPage(candidatePage, `${mode}-${route.name}-candidate`, candidateResponses),\n    ]);\n\n"
instrumented = addition_import + text.replace(before_setup, addition_setup + before_setup).replace(before_assert, addition_capture + before_assert)
assert instrumented.removeprefix(addition_import).replace(addition_setup, "").replace(addition_capture, "") == text
(root / test).write_text(instrumented)
subprocess.run(["git", "diff", "--exit-code", "--", "crates", "davinci", "npm", "Cargo.toml", "Cargo.lock", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"], check=True)
(output / "original-source-custody.json").write_text(json.dumps({
    "originalSourceH": H, "observerDriverSha": driver_sha,
    "originalTestSha256": hashlib.sha256(original).hexdigest(),
    "instrumentedTestSha256": hashlib.sha256(instrumented.encode()).hexdigest(),
    "observerSha256": hashlib.sha256(helper).hexdigest(),
    "upstreamPin": "8eff3cd7dd79a7f47bbf2b78202b9aa2070ec5a6",
    "originalVerdictAndAllOrderedCasesRetained": True, "producerFiles": records,
}, indent=2) + "\n")
print(f"Authenticated {len(records)} original producer files; observer driver {driver_sha}; source H {H}")
