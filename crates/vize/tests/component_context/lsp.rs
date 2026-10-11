use super::{
    lsp_process::{LspProcess, file_uri},
    support::{self, config, lsp_packet, persist, write},
};
use serde_json::{Value, json};
use std::fs;

#[test]
fn all_original_contexts_reach_distinct_workspace_documents_and_revisions() {
    let workspace = tempfile::tempdir().unwrap();
    let cases = support::cases();
    let mut folders = Vec::new();
    for case in &cases {
        let root = workspace.path().join(case["id"].as_str().unwrap());
        write(
            &root,
            case["filename"].as_str().unwrap(),
            case["source"].as_str().unwrap(),
        );
        write(&root, "vize.config.json", &config(case).to_string());
        folders.push(json!({"uri": file_uri(&root), "name": case["id"]}));
    }
    let mut lsp = LspProcess::spawn(workspace.path());
    lsp.retain_protocol();
    lsp.send(
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "processId":null,"rootUri":null,"workspaceFolders":folders,"capabilities":{},
            "initializationOptions":{"editor":false,"typecheck":false,"lint":true}
        }}),
    );
    let initialize = lsp.recv_response(1);
    assert!(initialize["error"].is_null(), "{initialize:#}");
    lsp.send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}));
    let mut observations = Vec::new();
    for case in &cases {
        let root = workspace.path().join(case["id"].as_str().unwrap());
        let file = root.join(case["filename"].as_str().unwrap());
        let uri = file_uri(&file);
        let source = case["source"].as_str().unwrap();
        for version in [1, 2, 3] {
            if version == 1 {
                lsp.send(json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{
                    "textDocument":{"uri":uri,"languageId":"vue","version":version,"text":source}
                }}));
            } else {
                lsp.send(json!({"jsonrpc":"2.0","method":"textDocument/didChange","params":{
                    "textDocument":{"uri":uri,"version":version},"contentChanges":[{"text":source}]
                }}));
            }
            let actual = lsp.recv_matching(|message| {
                message["method"] == "textDocument/publishDiagnostics"
                    && message["params"]["uri"] == uri.as_str()
                    && message["params"]["version"] == version
            });
            observations.push(
                json!({"caseId":case["id"],"source":source,"config":config(case),
                "expected":lsp_packet(case, &uri, version),"actual":actual}),
            );
            persist(
                "lsp-transport.json",
                &json!({"initialize": initialize, "observations": observations}),
            );
        }
        assert_eq!(fs::read_to_string(file).unwrap(), source);
        assert_eq!(
            fs::read_to_string(root.join("vize.config.json")).unwrap(),
            config(case).to_string()
        );
    }
    lsp.send(json!({"jsonrpc":"2.0","id":2,"method":"shutdown"}));
    let shutdown = lsp.recv_response(2);
    lsp.send(json!({"jsonrpc":"2.0","method":"exit"}));
    let status = lsp.wait_for_exit();
    let terminal = lsp.terminal_evidence();
    persist(
        "lsp-transport.json",
        &json!({
            "schema":"vize.component-context.actual-json-rpc-transport-v1",
            "initialize":initialize,"shutdown":shutdown,"observations":observations,"terminal":terminal
        }),
    );
    assert_eq!(observations.len(), 90);
    assert_eq!(shutdown, json!({"jsonrpc":"2.0","id":2,"result":null}));
    assert!(status.success(), "{terminal:#}");
    for observation in &observations {
        assert_eq!(
            observation["actual"], observation["expected"],
            "{observation:#}"
        );
    }
    let publications = terminal["publishedDiagnostics"].as_array().unwrap();
    assert_eq!(
        publications.len(),
        90,
        "unexpected complete publication: {terminal:#}"
    );
}

#[test]
fn watched_policy_replacement_does_not_leak_into_a_sibling_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let source = "<template>界😀<my-owned/><my-neighbor/></template>\r\n";
    let roots = [
        workspace.path().join("owned"),
        workspace.path().join("unowned"),
    ];
    let mut folders = Vec::new();
    for (index, root) in roots.iter().enumerate() {
        write(root, "Policy.vue", source);
        write(root, "vize.config.json", &policy(index == 0).to_string());
        folders.push(json!({"uri": file_uri(root), "name": index.to_string()}));
    }
    let mut lsp = LspProcess::spawn(workspace.path());
    lsp.retain_protocol();
    lsp.send(
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "processId":null,"rootUri":null,"workspaceFolders":folders,"capabilities":{},
            "initializationOptions":{"editor":false,"typecheck":false,"lint":true}
        }}),
    );
    let initialize = lsp.recv_response(1);
    assert!(initialize["error"].is_null(), "{initialize:#}");
    lsp.send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}));
    let mut observations = Vec::new();
    for (index, root) in roots.iter().enumerate() {
        let uri = file_uri(&root.join("Policy.vue"));
        lsp.send(
            json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{
                "textDocument":{"uri":uri,"languageId":"vue","version":1,"text":source}
            }}),
        );
        let actual = lsp.recv_matching(|message| {
            message["method"] == "textDocument/publishDiagnostics"
                && message["params"]["uri"] == uri.as_str()
                && message["params"]["version"] == 1
        });
        let case = expected_policy(source, index == 0);
        observations.push(json!({"expected":lsp_packet(&case, &uri, 1),"actual":actual}));
    }
    write(&roots[0], "vize.config.json", &policy(false).to_string());
    lsp.send(
        json!({"jsonrpc":"2.0","method":"workspace/didChangeWatchedFiles","params":{
            "changes":[{"uri":file_uri(&roots[0].join("vize.config.json")),"type":2}]
        }}),
    );
    let uri = file_uri(&roots[0].join("Policy.vue"));
    let actual = lsp.recv_matching(|message| {
        message["method"] == "textDocument/publishDiagnostics"
            && message["params"]["uri"] == uri.as_str()
            && message["params"]["version"] == 1
    });
    observations.push(
        json!({"expected":lsp_packet(&expected_policy(source, false), &uri, 1),"actual":actual}),
    );
    lsp.send(json!({"jsonrpc":"2.0","id":2,"method":"shutdown"}));
    let shutdown = lsp.recv_response(2);
    lsp.send(json!({"jsonrpc":"2.0","method":"exit"}));
    let status = lsp.wait_for_exit();
    let terminal = lsp.terminal_evidence();
    persist(
        "lsp-policy-replacement.json",
        &json!({"source":source,"initialize":initialize,
        "shutdown":shutdown,"observations":observations,"terminal":terminal}),
    );
    assert!(status.success(), "{terminal:#}");
    assert_eq!(shutdown, json!({"jsonrpc":"2.0","id":2,"result":null}));
    for observation in observations {
        assert_eq!(
            observation["actual"], observation["expected"],
            "{observation:#}"
        );
    }
    assert_eq!(
        fs::read_to_string(roots[0].join("Policy.vue")).unwrap(),
        source
    );
    assert_eq!(
        fs::read_to_string(roots[1].join("Policy.vue")).unwrap(),
        source
    );
}

fn policy(owned: bool) -> Value {
    json!({"compiler":{"customElements":if owned {vec!["my-owned"]} else {vec![]}},
        "linter":{"preset":"incremental","rules":{support::RULE:"warn"}},
        "languageServer":{"editor":false,"typecheck":false,"lint":true}})
}

fn expected_policy(source: &str, owned: bool) -> Value {
    let tags = if owned {
        vec!["my-neighbor"]
    } else {
        vec!["my-owned", "my-neighbor"]
    };
    let diagnostics = tags
        .into_iter()
        .map(|tag| {
            let start = source.find(tag).unwrap();
            json!({"message":"Component is used but not explicitly imported",
            "start":start,"end":start+tag.len(),
            "help":"Import the component in <script setup> or register it in components option"})
        })
        .collect::<Vec<_>>();
    json!({"source":source,"authoredExpectedPacket":{"diagnostics":diagnostics}})
}
