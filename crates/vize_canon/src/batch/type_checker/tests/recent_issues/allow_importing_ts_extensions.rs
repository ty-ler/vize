use super::super::{create_project_case, resolve_test_tsgo_binary, snapshot_project_diagnostics};
use vize_l0::{String, cstr};

fn write_case(name: &str, allow: Option<bool>) -> std::path::PathBuf {
    let project_root = create_project_case(
        name,
        &[
            (
                "src/math.ts",
                "export function double(value: number): number { return value * 2; }\n",
            ),
            (
                "src/main.ts",
                "import { double } from './math.ts';\nexport const four: number = double(2);\n",
            ),
            (
                "src/App.vue",
                r#"<script setup lang="ts">
import { double } from "./math.ts";
const four = double(2);
</script>
<template><p>{{ four }}</p></template>
"#,
            ),
        ],
    );
    let allow = allow.map_or_else(String::default, |value| {
        cstr!(",\n    \"allowImportingTsExtensions\": {value}")
    });
    std::fs::write(
        project_root.join("tsconfig.json"),
        cstr!(
            r#"{{
  "compilerOptions": {{
    "strict": true,
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "noEmit": true{allow}
  }},
  "include": ["src/**/*.ts", "src/**/*.vue"]
}}"#
        ),
    )
    .unwrap();
    project_root
}

#[test]
fn authored_ts_extensions_report_ts5097_by_default() {
    if resolve_test_tsgo_binary().is_none() {
        return;
    }
    let project_root = write_case("authored-ts-extension-default-9890", None);
    let Some(snapshot) = snapshot_project_diagnostics(&project_root) else {
        let _ = std::fs::remove_dir_all(&project_root);
        return;
    };

    assert_eq!(
        snapshot,
        vec![
            (
                String::from("src/App.vue"),
                Some(5097),
                String::from(
                    "2:24:error An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled."
                ),
            ),
            (
                String::from("src/main.ts"),
                Some(5097),
                String::from(
                    "1:24:error An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled."
                ),
            ),
        ]
    );
    let _ = std::fs::remove_dir_all(&project_root);
}

#[test]
fn authored_ts_extensions_remain_available_after_explicit_opt_in() {
    if resolve_test_tsgo_binary().is_none() {
        return;
    }
    let project_root = write_case("authored-ts-extension-opt-in-9890", Some(true));
    let Some(snapshot) = snapshot_project_diagnostics(&project_root) else {
        let _ = std::fs::remove_dir_all(&project_root);
        return;
    };
    assert!(
        snapshot.is_empty(),
        "explicit opt-in should stay enabled: {snapshot:#?}"
    );
    let _ = std::fs::remove_dir_all(&project_root);
}
