use std::{fs, path::PathBuf, process::Command};

// The original monorepo policy is retained in data/upstream_policy.rs.txt.
// Apply every imported fast-module rule to the checked graph, plus the actual
// locked registry runtime. corsa_ref is separate, unimported upstream CLI tooling.

const FAST_PATHS: &[&str] = &[
    "vendor/corsa_core/src/process.rs",
    "vendor/corsa_lsp/src/lsp/client.rs",
    "vendor/corsa_lsp/src/lsp/overlay.rs",
    "vendor/corsa_lsp/src/lsp/virtual_document.rs",
    "vendor/corsa_lsp/src/lsp/custom.rs",
    "vendor/corsa_orchestrator/src/orchestrator/api.rs",
    "vendor/corsa_orchestrator/src/orchestrator/distributed.rs",
    "vendor/corsa_orchestrator/src/orchestrator/raft/config.rs",
    "vendor/corsa_orchestrator/src/orchestrator/raft/messages.rs",
    "vendor/corsa_orchestrator/src/orchestrator/raft/mod.rs",
    "vendor/corsa_orchestrator/src/orchestrator/raft/node.rs",
    "vendor/corsa_orchestrator/src/orchestrator/raft/transport.rs",
    "vendor/corsa_orchestrator/src/orchestrator/state.rs",
];

#[test]
fn fast_modules_avoid_std_alloc_shorthands() {
    let root = workspace_root();
    let mut violations = Vec::new();
    let mut paths: Vec<_> = FAST_PATHS
        .iter()
        .map(|relative| root.join(relative))
        .collect();
    // Resolve the registry package from Cargo's actual locked graph; do not
    // silently omit its existing policy because it is not a workspace member.
    let metadata = Command::new(env!("CARGO"))
        .args(["metadata", "--locked", "--offline", "--format-version", "1"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert!(metadata.status.success(), "locked runtime metadata failed");
    let metadata: serde_json::Value = serde_json::from_slice(&metadata.stdout).unwrap();
    let runtime: Vec<_> = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|package| package["name"] == "corsa_runtime")
        .collect();
    assert_eq!(runtime.len(), 1, "exactly one runtime provider");
    assert_eq!(runtime[0]["version"], "1.14.2");
    assert!(
        runtime[0]["source"]
            .as_str()
            .unwrap()
            .starts_with("registry+")
    );
    paths.push(
        PathBuf::from(runtime[0]["manifest_path"].as_str().unwrap())
            .parent()
            .unwrap()
            .join("src/broadcast.rs"),
    );
    for path in paths {
        let content = fs::read_to_string(&path).unwrap();
        let body = content.split("\n#[cfg(test)]").next().unwrap_or(&content);
        for (index, line) in body.lines().enumerate() {
            if line.contains("format!(")
                || contains_word(line, "String")
                || contains_word(line, "Vec")
            {
                violations.push(format!("{}:{}", path.display(), index + 1));
            }
        }
    }
    assert!(
        violations.is_empty(),
        "fast-path allocation policy violated:\n{}",
        violations.join("\n")
    );
}

fn workspace_root() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            return dir;
        }
        assert!(
            dir.pop(),
            "failed to locate workspace root from {}",
            env!("CARGO_MANIFEST_DIR")
        );
    }
}

fn contains_word(line: &str, word: &str) -> bool {
    let bytes = line.as_bytes();
    let needle = word.as_bytes();
    let mut offset = 0;
    while let Some(index) = line[offset..].find(word) {
        let start = offset + index;
        let end = start + needle.len();
        let left = start
            .checked_sub(1)
            .and_then(|index| bytes.get(index).copied())
            .is_none_or(|byte| !is_ident(byte));
        let right = bytes.get(end).copied().is_none_or(|byte| !is_ident(byte));
        if left && right {
            return true;
        }
        offset = end;
    }
    false
}

fn is_ident(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

// These full shipping modules have an explicit ownership/evidence contract.
// Public owned receipts retain their Vec/String API; the measured preclose
// access check must avoid copying them on an alive owner. The original lexical
// rule above remains unchanged, including the actual locked registry runtime.
#[test]
fn moved_process_modules_have_complete_allocation_contract_membership() {
    let root = workspace_root();
    let directory = root.join("vendor/corsa_core/src/process");
    let mut actual = Vec::new();
    for entry in fs::read_dir(directory).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        assert!(
            entry.file_type().unwrap().is_file(),
            "physical source required"
        );
        assert!(path.extension().is_some_and(|extension| extension == "rs"));
        actual.push(entry.file_name().into_string().unwrap());
    }
    actual.sort();
    assert_eq!(
        actual,
        ["guard.rs", "lifetime.rs", "owned.rs", "preclose.rs"]
    );
    let receipt = root.join("vendor/corsa_core/src/process_receipt.rs");
    assert!(fs::symlink_metadata(receipt).unwrap().file_type().is_file());
}
