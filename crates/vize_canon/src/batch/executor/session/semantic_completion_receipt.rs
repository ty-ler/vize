//! Separately scoped test evidence for required same-config native completion.
use super::{CorsaProjectClient, VirtualProject};
use corsa_lsp::process::ProcessObserver;
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    fs,
    path::{Path, PathBuf},
};
use vize_l0::cstr;

thread_local! { static PENDING: RefCell<Option<(ProcessObserver, PathBuf)>> = const { RefCell::new(None) }; }

pub(super) fn enabled() -> bool {
    std::env::var_os("VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR").is_some()
}

pub(super) fn capture(
    client: &mut CorsaProjectClient,
    project: &VirtualProject,
    uris: &[vize_l0::String],
    raw: &impl std::fmt::Debug,
) {
    let Some(dir) = std::env::var_os("VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR").map(PathBuf::from)
    else {
        return;
    };
    let name = project.project_root().file_name().unwrap();
    let dir = dir.join(name);
    fs::create_dir_all(&dir).unwrap();
    let uri = uris
        .iter()
        .find(|uri| uri.ends_with("Comp0.vue.ts"))
        .expect("the scoped frozen corpus owns Comp0.vue");
    let native = client.batch_test_receipt(uri);
    let observer = client
        .batch_test_process_observer()
        .expect("real diagnosing LSP process required");
    PENDING.with(|pending| *pending.borrow_mut() = Some((observer.clone(), dir.clone())));
    let config = project.generated_tsconfig_path();
    let mut receipt = json!({"native":native, "requestedUris":uris, "generatedConfig":config,
        "generatedConfigBytes":fs::read(&config).unwrap(), "rawDiagnostics":cstr!("{raw:#?}"),
        "generatedFiles":project.virtual_files_sorted().into_iter().map(|file|json!({"original":file.original_path,"virtual":file.virtual_path,"code":file.content.as_str(),"sourceMap":cstr!("{:#?}",file.source_map)})).collect::<Vec<_>>(),
        "wholePhysicalFiles":physical(project.virtual_root()), "spawnReceiptsBeforeClose":cstr!("{:?}",observer.receipts())});
    fs::write(
        dir.join("same-owner.json"),
        serde_json::to_vec_pretty(&receipt).unwrap(),
    )
    .unwrap();
    receipt["leafProvider"] = client.batch_test_leaf_source(uri, &native);
    fs::write(
        dir.join("same-owner.json"),
        serde_json::to_vec_pretty(&receipt).unwrap(),
    )
    .unwrap();
    assert_eq!(receipt["native"]["mode"], "editor-lsp");
    assert_eq!(
        receipt["native"]["nativeShutdownMode"],
        "authenticated-native-7.0.2-shutdown-eof"
    );
    assert_eq!(
        receipt["native"]["nativeInitializeResponse"]["serverInfo"],
        json!({"name":"typescript-go","version":"7.0.2"})
    );
    assert_eq!(receipt["native"]["selectedConfig"], json!(config));
    assert_eq!(
        receipt["native"]["project"]["compilerOptions"],
        receipt["native"]["normalizedRequestedOptions"]
    );
    assert_eq!(
        receipt["native"]["project"]["compilerOptions"]["strict"],
        true
    );
    assert_eq!(
        receipt["native"]["processPid"],
        json!(observer.receipts()[0].pid)
    );
    let sources = receipt["native"]["sourceNamesResponse"]
        .as_array()
        .expect("full native source list required");
    let mut roots: Vec<_> = receipt["native"]["project"]["rootFiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    let mut requested: Vec<_> = receipt["native"]["normalizedRequestedFiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    roots.sort();
    requested.sort();
    assert_eq!(
        roots, requested,
        "the full configured root membership must agree"
    );
    let mut authored: Vec<_> = sources
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|v| Path::new(v).parent() == Some(project.virtual_root()))
        .map(|v| Path::new(v).file_name().unwrap().to_str().unwrap())
        .filter(|v| !v.ends_with(".d.ts"))
        .collect();
    authored.sort();
    assert_eq!(
        authored,
        vec![
            "Comp0.vue.ts",
            "Comp1.vue.ts",
            "Comp2.vue.ts",
            "Comp3.vue.ts",
            "shared.ts"
        ]
    );
    assert_eq!(receipt["leafProvider"]["qualified"], true);
    let original_leaf = include_bytes!(
        "../../../../../../tests/_fixtures/differential/typechecker/native-semantic-completion/inputs/node_modules/leaf-types/index.d.ts.txt"
    );
    for row in receipt["leafProvider"]["loadedLeafSources"]
        .as_array()
        .unwrap()
    {
        assert_eq!(row["completeNativeText"], json!(original_leaf.as_slice()));
        assert_eq!(
            row["completePhysicalBytes"],
            json!(original_leaf.as_slice())
        );
    }
}

pub(in crate::batch::executor) fn finish() -> Value {
    PENDING.with(|pending| {
        let Some((observer,dir))=pending.borrow_mut().take() else {return Value::Null};
        let receipts=observer.receipts();
        let rows:Vec<_>=receipts.iter().map(|r|json!({"pid":r.pid,"completed":r.completed,"stderr":r.stderr,"stderrComplete":r.stderr_complete,"stderrError":r.stderr_error,"processError":r.process_error,"status":cstr!("{:?}",r.exit_status),"exitCode":r.exit_status.and_then(|s|s.code()),"timedOut":r.timed_out,"killRequested":r.kill_requested,"reaped":r.reaped,"elapsedNs":r.elapsed.as_nanos()})).collect();
        let rows=json!(rows);
        fs::write(dir.join("terminal.json"),serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
        rows
    })
}

fn physical(root: &Path) -> Vec<Value> {
    fn visit(root: &Path, path: &Path, rows: &mut Vec<Value>) {
        let mut entries: Vec<_> = fs::read_dir(path).unwrap().map(|e| e.unwrap()).collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let p = entry.path();
            let kind = entry.file_type().unwrap();
            if kind.is_dir() {
                visit(root, &p, rows)
            } else if kind.is_file() {
                rows.push(
                    json!({"file":p.strip_prefix(root).unwrap(),"bytes":fs::read(&p).unwrap()}),
                )
            } else {
                rows.push(json!({"file":p.strip_prefix(root).unwrap(),"symlinkTarget":fs::read_link(&p).unwrap()}))
            }
        }
    }
    let mut rows = Vec::new();
    visit(root, root, &mut rows);
    rows
}
