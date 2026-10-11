//! Whole pinned source and genuine preparation, copied without provider edits.
#![expect(
    clippy::disallowed_types,
    clippy::disallowed_macros,
    reason = "complete native fixture custody"
)]

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub(super) const PIN: &str = "8eff3cd7dd79a7f47bbf2b78202b9aa2070ec5a6";
pub(super) const TARGET: &str = "app/components/scrollAttention/VFScrollAttention.vue";

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
            std::env::temp_dir().join(format!("vize-vuefes-native-{}", std::process::id()))
        })
        .join("generic-component/vuefes/bytes");
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join(&hash);
    if file.exists() {
        assert_eq!(fs::read(&file).unwrap(), bytes);
    } else {
        fs::write(&file, bytes).unwrap();
    }
    json!({"sha256":hash,"byteLength":bytes.len(),"wholeRetainedBytes":file,
        "relativeBlob":format!("vuefes/bytes/{hash}")})
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

pub(super) fn snapshot(temporary: &Path) -> (PathBuf, Vec<PathBuf>, Value) {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let relative = Path::new("tests/_fixtures/_git/vuefes-2025");
    let original = repo.join(relative);
    assert_eq!(
        String::from_utf8(git(&original, &["rev-parse", "HEAD"]))
            .unwrap()
            .trim(),
        PIN
    );
    assert_eq!(
        String::from_utf8(git(
            repo,
            &["ls-tree", "HEAD", "--", relative.to_str().unwrap()]
        ))
        .unwrap(),
        format!("160000 commit {PIN}\t{}\n", relative.display())
    );
    assert!(
        git(
            &original,
            &["status", "--porcelain", "--untracked-files=no"]
        )
        .is_empty(),
        "genuine preparation must restore every authored byte including locks"
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
    let preparation = capture.join("vuefes-2025/preparation/receipt.json");
    let receipt: Value = serde_json::from_slice(&fs::read(&preparation).unwrap()).unwrap();
    assert_eq!(receipt["revision"], PIN);
    assert_eq!(receipt["failed"], false);
    assert_eq!(receipt["authoredPreserved"], true);
    assert_eq!(receipt["sourceMutations"], json!([]));
    assert!(
        receipt["runtime"]["version"]
            .as_str()
            .unwrap()
            .starts_with("v22.")
    );
    let workspace = temporary.join("workspace");
    let root = workspace.join(relative);
    fs::create_dir_all(&root).unwrap();
    let archive = temporary.join("authored.tar");
    let archived = Command::new("git")
        .arg("-C")
        .arg(&original)
        .args(["archive", "--format=tar", "--output"])
        .arg(&archive)
        .arg(PIN)
        .output()
        .unwrap();
    assert!(archived.status.success(), "{archived:?}");
    let extracted = Command::new("tar")
        .arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&root)
        .output()
        .unwrap();
    assert!(extracted.status.success(), "{extracted:?}");
    let root = root.canonicalize().unwrap();
    let mut generated = Vec::new();
    for entry in receipt["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["role"] == "nuxt-generated-provider")
    {
        let source = Path::new(entry["path"].as_str().unwrap());
        let relative = source.strip_prefix(&original).unwrap();
        assert!(relative.starts_with(".nuxt"));
        let bytes = fs::read(source).unwrap();
        assert_eq!(sha256(&bytes), entry["sha256"]);
        let target = root.join(relative);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, &bytes).unwrap();
        generated
            .push(json!({"originalPath":source,"copiedPath":target,"completeBytes":blob(&bytes)}));
    }
    assert!(root.join(".nuxt/tsconfig.json").is_file());
    assert!(root.join(".nuxt/imports.d.ts").is_file());
    let mut providers = Vec::new();
    for ancestor in original
        .ancestors()
        .take_while(|ancestor| ancestor.starts_with(repo))
    {
        let provider = ancestor.join("node_modules");
        let target = workspace
            .join(ancestor.strip_prefix(repo).unwrap())
            .join("node_modules");
        let present = provider.is_dir();
        let physical = present.then(|| provider.canonicalize().unwrap());
        if let Some(physical) = &physical {
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink(physical, &target).unwrap();
        }
        providers.push(json!({"originalPath":provider,"isolatedPath":target,"present":present,"physical":physical}));
    }
    assert!(root.join("node_modules/vue/package.json").is_file());
    let old: Value = serde_json::from_slice(
        &fs::read(repo.join("tests/snapshots/check/__snapshots__/vuefes-2025-check.snap")).unwrap(),
    )
    .unwrap();
    assert_eq!(old["fileCount"], 81);
    assert_eq!(old["errorCount"], 47);
    let authored_vue = git(&original, &["ls-files", "-z", "--", "app"]);
    let mut roots = String::from_utf8(authored_vue)
        .unwrap()
        .split('\0')
        .filter(|file| file.ends_with(".vue"))
        .map(|file| root.join(file))
        .collect::<Vec<_>>();
    roots.sort();
    let mut historical = old["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|file| file["file"].as_str())
        .filter(|file| file.ends_with(".vue"))
        .map(|file| root.join(file))
        .collect::<Vec<_>>();
    historical.sort();
    assert_eq!(roots.len(), 71);
    assert_eq!(
        roots, historical,
        "the exact original CLI app/**/*.vue roots are required"
    );
    assert_eq!(
        fs::read(original.join(TARGET)).unwrap(),
        fs::read(root.join(TARGET)).unwrap()
    );
    let custody = json!({"revision":PIN,"originalRoot":original,"isolatedRoot":root,
        "wholeTrackedArchive":blob(&fs::read(archive).unwrap()),
        "wholeTrackedTree":String::from_utf8(git(&original, &["ls-tree", "-r", PIN])).unwrap(),
        "wholePreparationReceipt":receipt,"wholeGeneratedProviders":generated,
        "nearestFirstProviderScopes":providers,"exactOriginal71VueRoots":roots,
        "originalTargetWholeSource":blob(&fs::read(original.join(TARGET)).unwrap()),
        "originalAppArgv":["check","app/**/*.vue","--format","json","--quiet","--corsa-path"],
        "wholeHistorical81File47ErrorPacket":old,
        "referenceFactoryOptionsWholeDebug":format!("{:#?}", crate::BatchTypeCheckerOptions::default()),
        "executionWidths":{"serverCount":1,"checkerCount":1},
        "scope":"normal Batch reference factory; original CLI adds Nuxt options and alias-wrapper config; no public CLI execution identity or full App acceptance credit",
    });
    (root, roots, custody)
}
