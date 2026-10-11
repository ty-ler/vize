//! Frozen parser abort must complete semantics in the actual configured owner.
#![cfg(unix)]
use super::semantic_completion;
use crate::batch::{VirtualProject, executor::CorsaExecutor};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use vize_l0::{String, cstr};

const CASE: &str = include_str!(
    "../../../../../../tests/_fixtures/differential/typechecker/native-semantic-completion/case.json"
);

#[test]
fn native_semantic_completion_keeps_frozen_full_vector_and_actual_terminal_owner() {
    if std::env::var_os("VIZE_TEST_DISABLE_TSGO").is_some() {
        return;
    }
    let native = vize_carton::corsa_resolver::resolve_corsa_executable(
        vize_carton::corsa_resolver::CorsaResolveRequest {
            explicit_path: std::env::var_os("CORSA_PATH").as_deref().map(Path::new),
            project_root: Some(Path::new(env!("CARGO_MANIFEST_DIR"))),
        },
    )
    .expect("required real native configured factory");
    let root = std::env::var_os("VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR")
        .map(PathBuf::from)
        .map(|dir| dir.join("factory-escaped"))
        .unwrap_or_else(|| tempfile::tempdir().unwrap().keep());
    fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let case: Value = serde_json::from_str(CASE).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/_fixtures/differential/typechecker/native-semantic-completion");
    for entry in case["inputFiles"].as_array().unwrap() {
        let bytes = fs::read(fixture.join(entry["fixture"].as_str().unwrap())).unwrap();
        let mut digest = String::with_capacity(64);
        const HEX: &[u8] = b"0123456789abcdef";
        for b in Sha256::digest(&bytes) {
            digest.push(HEX[usize::from(b >> 4)] as char);
            digest.push(HEX[usize::from(b & 15)] as char)
        }
        assert_eq!(digest.as_str(), entry["sha256"].as_str().unwrap());
        assert_eq!(bytes.len(), entry["bytes"].as_u64().unwrap() as usize);
        let path = root.join(entry["file"].as_str().unwrap());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    let mut project = VirtualProject::new(&root).unwrap();
    project.set_tsconfig_path(Some(root.join("tsconfig.json")));
    let files: Vec<_> = case["reportedFiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| root.join(v.as_str().unwrap()))
        .collect();
    project.register_paths(&files).unwrap();
    project.register_reachable_dependencies().unwrap();
    project.ensure_included_sources().unwrap();
    let executor = CorsaExecutor::with_corsa_path(&root, Some(&native)).unwrap();
    let result = executor.check_with_servers(&project, Some(1));
    let terminal = semantic_completion::finish();
    let result = result.unwrap();
    let mut whole:Vec<_>=result.diagnostics.iter().map(|row|json!({"file":row.file.strip_prefix(&root).unwrap(),"line":row.line,"column":row.column,"code":row.code,"severity":row.severity,"message":row.message.as_str(),"blockType":row.block_type.map(|block|cstr!("{block:?}"))})).collect();
    whole.sort_by(|a, b| a["file"].as_str().cmp(&b["file"].as_str()));
    if let Some(dir) = std::env::var_os("VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR").map(PathBuf::from) {
        fs::write(dir.join("factory-escaped/result.json"),serde_json::to_vec_pretty(&json!({"nativeBinary":native,"diagnostics":whole,"success":result.success,"exitCode":result.exit_code})).unwrap()).unwrap();
        assert_eq!(terminal.as_array().unwrap().len(), 1);
        let receipt = &terminal[0];
        assert_eq!(receipt["completed"], true);
        assert_eq!(receipt["stderrComplete"], true);
        assert_eq!(receipt["exitCode"], 0);
        assert_eq!(receipt["timedOut"], false);
        assert_eq!(receipt["killRequested"], false);
        assert_eq!(receipt["reaped"], true);
        assert_eq!(receipt["stderrError"], Value::Null);
        assert_eq!(receipt["processError"], Value::Null);
        assert_eq!(
            receipt["stderr"],
            json!(b"error handling method 'exit': EOF\n".as_slice())
        );
    }
    assert_eq!(json!(whole), case["expectedDiagnostics"]);
    assert_eq!((result.success, result.exit_code), (false, 1));
}
