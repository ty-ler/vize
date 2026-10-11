//! Observe the authored four with the fixture's genuine configured vue-tsc.
use super::{
    super::packets,
    fixture::{assert_prepared_bytes, blob},
};
use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};

const INSPECT: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = process.argv[1];
const requireCore = createRequire(path.join(root, 'packages/core/package.json'));
const cli = fs.realpathSync(requireCore.resolve('vue-tsc/bin/vue-tsc.js'));
const requireCli = createRequire(cli);
const parser = fs.realpathSync(requireCli.resolve('typescript'));
console.log(JSON.stringify({node:process.execPath,nodeVersion:process.version,cli,
  index:fs.realpathSync(requireCore.resolve('vue-tsc')),
  vueTscVersion:requireCore('vue-tsc/package.json').version,
  parser,parserVersion:requireCli('typescript').version,
  tsc:fs.realpathSync(requireCli.resolve('typescript/lib/tsc')),
  manifests:['vue-tsc','typescript','vue','@vue/tsconfig'].map(name=>({name,
    file:fs.realpathSync(requireCore.resolve(name+'/package.json')),
    version:requireCore(name+'/package.json').version}))}));
"#;

pub(super) fn observe(prepared: &Value) {
    assert_prepared_bytes(prepared);
    let root = Path::new(prepared["cwd"].as_str().unwrap());
    let node = Path::new(prepared["runtime"]["executable"].as_str().unwrap());
    let inspection = Command::new(node)
        .current_dir(root)
        .args(["-e", INSPECT])
        .arg(root)
        .output()
        .unwrap();
    packets::retain(
        "reka-owned-vue-tsc-inspection",
        &json!({
            "wholeNodeExecutable":blob(&fs::read(node).unwrap()),"wholeInspectionScript":INSPECT,
            "wholeStdout":blob(&inspection.stdout),"wholeStderr":blob(&inspection.stderr),
            "status":inspection.status.code(),
        }),
    );
    assert!(inspection.status.success());
    let metadata: Value = serde_json::from_slice(&inspection.stdout).unwrap();
    assert_eq!(metadata["node"], json!(node));
    assert_eq!(metadata["nodeVersion"], prepared["runtime"]["version"]);
    assert_eq!(metadata["vueTscVersion"], "3.2.6");
    assert_eq!(metadata["parserVersion"], "5.8.3");
    assert_eq!(metadata["parser"], prepared["providers"]["parserEntry"]);
    for (name, expected) in [
        ("vue-tsc", "3.2.6"),
        ("typescript", "5.8.3"),
        ("vue", "3.5.17"),
        ("@vue/tsconfig", "0.7.0"),
    ] {
        let manifest = metadata["manifests"]
            .as_array()
            .unwrap()
            .iter()
            .find(|manifest| manifest["name"] == name)
            .unwrap();
        assert_eq!(manifest["version"], expected);
        assert!(
            Path::new(manifest["file"].as_str().unwrap())
                .starts_with(root.join("node_modules/.pnpm"))
        );
    }
    let config = root.join(super::super::super::CONFIG_PATH);
    let cli = Path::new(metadata["cli"].as_str().unwrap());
    assert!(cli.starts_with(root.join("node_modules/.pnpm")));
    let output = Command::new(node)
        .current_dir(root)
        .arg(cli)
        .arg("-p")
        .arg(&config)
        .args(["--noEmit", "--pretty", "false"])
        .output()
        .unwrap();
    packets::retain(
        "reka-owned-vue-tsc-authored-four",
        &json!({
            "wholeInspectionMetadata":metadata,"node":node,"cli":cli,"selectedConfig":config,
            "argv":[cli.to_str().unwrap(),"-p",config.to_str().unwrap(),"--noEmit","--pretty","false"],
            "wholeOriginalConfig":blob(&fs::read(&config).unwrap()),
            "wholeVueTscCli":blob(&fs::read(cli).unwrap()),
            "wholeVueTscIndex":blob(&fs::read(metadata["index"].as_str().unwrap()).unwrap()),
            "wholeTypeScriptTscEntry":blob(&fs::read(metadata["tsc"].as_str().unwrap()).unwrap()),
            "wholeManifests":metadata["manifests"].as_array().unwrap().iter().map(|manifest| json!({
                "identity":manifest,"wholeBytes":blob(&fs::read(manifest["file"].as_str().unwrap()).unwrap()),
            })).collect::<Vec<_>>(),
            "status":output.status.code(),"wholeStdout":blob(&output.stdout),"wholeStderr":blob(&output.stderr),
            "scope":"genuine configured vue-tsc observes the authored four; its broader configured input/diagnostic set is not public App or native diagnostic parity",
        }),
    );
    assert_eq!(output.status.code(), Some(2));
    let stdout = std::str::from_utf8(&output.stdout).unwrap();
    for expected in [
        "packages/core/src/Combobox/story/ComboboxAsyncOptions.story.vue(14,34): error TS7006: Parameter 'i' implicitly has an 'any' type.",
        "packages/core/src/Combobox/story/ComboboxAsyncOptions.story.vue(14,108): error TS7006: Parameter 'i' implicitly has an 'any' type.",
        "packages/core/src/DateRangeField/story/DateRangeFieldValidation.story.vue(2,15): error TS2305: Module '\"@/shared/date\"' has no exported member 'Matcher'.",
        "packages/core/src/DateRangeField/story/DateRangeFieldValidation.story.vue(10,38): error TS7006: Parameter 'date' implicitly has an 'any' type.",
    ] {
        assert_eq!(
            stdout
                .lines()
                .filter(|line| line.ends_with(expected))
                .count(),
            1
        );
    }
    let status = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["status", "--porcelain", "--untracked-files=no"])
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(
        status.stdout.is_empty(),
        "configured vue-tsc must preserve all original authored bytes"
    );
    assert_prepared_bytes(prepared);
}
