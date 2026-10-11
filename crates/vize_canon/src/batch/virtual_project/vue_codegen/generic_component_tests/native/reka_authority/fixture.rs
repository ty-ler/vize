//! Authenticate genuine preparation before copying the unchanged pinned source.
#![expect(
    clippy::disallowed_types,
    clippy::disallowed_macros,
    reason = "whole immutable native fixture custody"
)]

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub(super) const TARGET: &str = "packages/core/src/Toast/story/ToastDemo.story.vue";

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn blob(bytes: &[u8]) -> Value {
    let hash = sha256(bytes);
    let directory = std::env::var_os("VIZE_NATIVE_SYNTAX_CAPTURE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("vize-reka-native-{}", std::process::id()))
        })
        .join("generic-component/reka-authority/bytes");
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join(&hash);
    if file.exists() {
        assert_eq!(fs::read(&file).unwrap(), bytes);
    } else {
        fs::write(&file, bytes).unwrap();
    }
    json!({"sha256":hash,"byteLength":bytes.len(),"wholeRetainedBytes":file,
        "relativeBlob":format!("reka-authority/bytes/{hash}")})
}

fn git(root: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    output.stdout
}

pub(super) fn assert_prepared_bytes(prepared: &Value) {
    let executable = Path::new(prepared["runtime"]["executable"].as_str().unwrap());
    assert_eq!(
        sha256(&fs::read(executable).unwrap()),
        prepared["runtime"]["sha256"]
    );
    for file in prepared["files"].as_array().unwrap() {
        let path = Path::new(file["file"].as_str().unwrap());
        assert_eq!(json!(path.canonicalize().unwrap()), file["physical"]);
        assert_eq!(sha256(&fs::read(path).unwrap()), file["sha256"]);
    }
}

pub(super) fn snapshot(temporary: &Path) -> (PathBuf, Vec<PathBuf>, Value, Value) {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let relative = Path::new("tests/_fixtures/_git/reka-ui");
    let original = repo.join(relative);
    assert_eq!(
        String::from_utf8(git(
            repo,
            &["ls-tree", "HEAD", "--", relative.to_str().unwrap()]
        ))
        .unwrap(),
        format!(
            "160000 commit {}\t{}\n",
            super::super::super::PIN,
            relative.display()
        )
    );
    assert!(
        git(
            &original,
            &["status", "--porcelain", "--untracked-files=no"]
        )
        .is_empty()
    );
    let capture = std::env::var_os("VIZE_APP_CHECK_CAPTURE_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("VIZE_NATIVE_SYNTAX_CAPTURE_DIR").map(|path| {
                PathBuf::from(path)
                    .parent()
                    .unwrap()
                    .join("original-app-packets")
            })
        })
        .unwrap_or_else(|| repo.join("target/app-e2e-logs"));
    let prepared: Value = serde_json::from_slice(
        &fs::read(capture.join("reka-ui/preparation/receipt.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(prepared["pin"], super::super::super::PIN);
    assert_eq!(prepared["cwd"], json!(original));
    assert_eq!(prepared["failed"], false);
    assert_eq!(prepared["authoredPreserved"], true);
    assert_eq!(prepared["sourceMutations"], json!([]));
    assert_eq!(prepared["command"]["completed"], true);
    assert_eq!(prepared["providers"]["parserVersion"], "5.8.3");
    assert_eq!(prepared["providers"]["options"]["strict"], true);
    for (name, version) in [
        ("typescript", "5.8.3"),
        ("@vue/tsconfig", "0.7.0"),
        ("vue", "3.5.17"),
    ] {
        let provider = prepared["providers"]["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|provider| provider["name"] == name)
            .unwrap();
        assert_eq!(provider["expected"], version);
        let manifest: Value = serde_json::from_slice(
            &fs::read(Path::new(provider["logical"].as_str().unwrap()).join("package.json"))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["name"], name);
        assert_eq!(manifest["version"], version);
        assert_eq!(
            json!(
                Path::new(provider["logical"].as_str().unwrap())
                    .canonicalize()
                    .unwrap()
            ),
            provider["physical"]
        );
    }
    assert_prepared_bytes(&prepared);
    let (root, inherited) = super::super::install::snapshot(temporary);
    let mut scopes = Vec::new();
    let expected_owners = [
        original.join("packages/core"),
        original.join(".histoire"),
        original.clone(),
        repo.join("tests/_fixtures/_git"),
        repo.join("tests/_fixtures"),
        repo.join("tests"),
        repo.to_path_buf(),
    ];
    let observed = prepared["providerScopes"].as_array().unwrap();
    assert_eq!(observed.len(), expected_owners.len());
    for (scope, owner) in observed.iter().zip(expected_owners) {
        assert_eq!(scope["owner"], json!(owner));
        let source = owner.join("node_modules");
        let isolated = temporary
            .join("workspace")
            .join(owner.strip_prefix(repo).unwrap())
            .join("node_modules");
        assert_eq!(source.is_dir(), scope["present"].as_bool().unwrap());
        assert_eq!(isolated.is_dir(), source.is_dir());
        if source.is_dir() {
            assert_eq!(json!(source.canonicalize().unwrap()), scope["physical"]);
            assert_eq!(
                isolated.canonicalize().unwrap(),
                source.canonicalize().unwrap()
            );
        }
        scopes.push(json!({"wholeOriginalScope":scope,"isolated":isolated,"actualReadlink":fs::read_link(&isolated).ok()}));
    }
    let mut roots = String::from_utf8(git(&original, &["ls-files", "-z", "--", "packages"]))
        .unwrap()
        .split('\0')
        .filter(|file| file.ends_with(".vue"))
        .map(|file| root.join(file))
        .collect::<Vec<_>>();
    roots.sort();
    assert_eq!(roots.len(), 729);
    let historical: Value = serde_json::from_slice(
        &fs::read(repo.join("tests/snapshots/check/__snapshots__/reka-ui-check.snap")).unwrap(),
    )
    .unwrap();
    assert_eq!(historical["fileCount"], 913);
    assert_eq!(historical["errorCount"], 3113);
    let current: Value =
        serde_json::from_slice(&fs::read(capture.join("reka-ui/parsed.json")).unwrap()).unwrap();
    for packet in [&historical, &current] {
        let mut selected = packet["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|file| file["file"].as_str())
            .filter(|file| file.ends_with(".vue"))
            .map(|file| {
                let path = Path::new(file);
                root.join(if path.is_absolute() {
                    path.strip_prefix(&original).unwrap()
                } else {
                    path
                })
            })
            .collect::<Vec<_>>();
        selected.sort();
        assert_eq!(
            roots, selected,
            "the exact original packages/**/*.vue root set must remain selected"
        );
    }
    let bytes = prepared["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            json!({"wholeIdentity":file,
        "wholeBytes":blob(&fs::read(file["file"].as_str().unwrap()).unwrap())})
        })
        .collect::<Vec<_>>();
    let custody = json!({"revision":super::super::super::PIN,"existingPinnedSnapshot":inherited,
        "wholePinnedAuthoredArchive":blob(&fs::read(temporary.join("tracked.tar")).unwrap()),
        "wholePreparationReceipt":prepared,"wholeRetainedPreparationFiles":bytes,
        "wholePreparationRuntime":blob(&fs::read(prepared["runtime"]["executable"].as_str().unwrap()).unwrap()),
        "exactOriginal729VueRoots":roots,"nearestFirstOriginalSevenScopes":scopes,
        "originalTargetWholeSource":blob(&fs::read(original.join(TARGET)).unwrap()),
        "wholeHistorical913File3113ErrorPacket":historical,"wholeFreshOriginalAppPacket":current,
        "scope":"explicit unchanged core app config reference; preparation TS5.8.3 is not the diagnosing native7 engine; no public CLI execution identity",
    });
    (root, roots, custody, prepared)
}

pub(super) fn bind_native(prepared: &Value, native: &Value) -> Value {
    let bindings = native["loadedProviderSources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|source| {
            source["nativeSourceName"].as_str().is_some_and(|name| {
                name.ends_with("/vue/dist/vue.d.ts")
                    || name.ends_with("/@vue/runtime-core/dist/runtime-core.d.ts")
            })
        })
        .map(|source| {
            let expected = prepared["files"].as_array().unwrap().iter().find(|file| {
                file["role"] == "installed-vue-declaration-candidate"
                    && file["physical"] == source["physical"]
            });
            let matches = expected
                .is_some_and(|file| file["sha256"] == source["completeNativeText"]["sha256"]);
            json!({"nativeSource":source,"wholePreparedIdentity":expected,"qualified":matches})
        })
        .collect::<Vec<_>>();
    json!({"bindings":bindings,"qualified":bindings.len() >= 2 && bindings.iter().all(|binding| binding["qualified"] == true),
        "scope":"native Vue and runtime-core source identities/text must bind to genuine pinned fixture-owned prepared declarations, without ambient fallback"})
}
