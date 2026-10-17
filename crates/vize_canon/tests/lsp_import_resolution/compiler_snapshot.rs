//! Real native requests retain admitted compiler authority, including cold startup.
#![expect(
    clippy::unwrap_used,
    reason = "complete native fixture assertions panic"
)]
#![expect(
    clippy::string_slice,
    reason = "test queries an independently authored declaration"
)]
use super::*;
use vize_canon::{CompilerConfigurationSnapshot, CorsaVueVirtualDocumentOptions};

#[expect(
    clippy::panic,
    reason = "the native fixture requires the complete markdown variant"
)]
async fn assert_typed_hover(bridge: &CorsaBridge, source: &Path, text: &str, typ: &str) {
    let document = bridge
        .open_vue_virtual_document(source, text, CorsaVueVirtualDocumentOptions::default())
        .await
        .unwrap();
    let declaration = vize_l0::cstr!("const value: {typ}");
    let offset = document.code.find(declaration.as_str()).unwrap() + "const ".len();
    let prefix = &document.code[..offset];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() as u32;
    let character = prefix.rsplit('\n').next().unwrap().encode_utf16().count() as u32;
    let hover = bridge
        .hover(document.request_uri.as_str(), line, character + 2)
        .await
        .unwrap()
        .expect("the retained native owner must serve a complete typed hover");
    match hover.contents {
        LspHoverContents::Markup(markup) => {
            assert_eq!(markup.kind, "markdown");
            assert_eq!(
                markup.value,
                // Native 7.0.2 gitHead 2bd066d87f5bafd315be9f40889d0a60b9e58e0b:
                // internal/ls/hover.go writeCode writes LF after the closing fence.
                vize_l0::cstr!("```typescript\nconst value: {typ}\n```\n").as_str()
            );
        }
        other => panic!("expected complete native markdown, received {other:?}"),
    }
    assert_eq!(
        serde_json::to_value(hover.range).unwrap(),
        serde_json::json!({"start":{"line":line,"character":character},"end":{"line":line,"character":character+5}})
    );
}

#[test]
#[cfg(unix)]
fn admitted_compiler_configuration_survives_deleted_extends_before_first_native_request_and_rebuilds()
 {
    let native = resolve_test_tsgo_binary();
    if native.is_none() {
        assert_ne!(
            std::env::var("VIZE_TEST_REQUIRE_TSGO").as_deref(),
            Ok("1"),
            "this acceptance requires the actual native backend"
        );
        return;
    }
    for warmed in [false, true] {
        let root = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(
            workspace_root().join("playground/node_modules"),
            root.path().join("node_modules"),
        )
        .unwrap();
        let config = root.path().join("tsconfig.json");
        let base = root.path().join("tsconfig.base.json");
        let policy = r#"{"compilerOptions":{"strict":true,"strictNullChecks":true,"target":"ES2022","module":"ESNext","moduleResolution":"bundler","noEmit":true}}"#;
        std::fs::write(&base, policy).unwrap();
        std::fs::write(
            &config,
            r#"{"extends":"./tsconfig.base.json","include":["*.vue"]}"#,
        )
        .unwrap();
        let source = root.path().join("TypedPanel.vue");
        let original = "<script setup lang=\"ts\">\nconst value: string = null;\n</script>\n<template>{{ value }}</template>\n";
        std::fs::write(&source, original).unwrap();
        let admitted = std::sync::Arc::new(
            CompilerConfigurationSnapshot::capture(root.path(), Some(&config)).unwrap(),
        );
        let bridge = CorsaBridge::with_compiler_configuration(
            CorsaBridgeConfig {
                corsa_path: native.clone(),
                working_dir: Some(root.path().to_path_buf()),
                tsconfig_path: Some(config.clone()),
                ..Default::default()
            },
            Default::default(),
            Some(admitted),
        );
        corsa::runtime::block_on(async {
            if warmed {
                bridge.spawn().await.unwrap();
                assert_typed_hover(&bridge, &source, original, "string").await;
            }
            std::fs::remove_file(&base).unwrap();
            assert!(CompilerConfigurationSnapshot::capture(root.path(), Some(&config)).is_err());
            bridge.spawn().await.unwrap();
            assert_typed_hover(&bridge, &source, original, "string").await;
            let unsaved =
                original.replace("const value: string = null", "const value: number = 42");
            assert_typed_hover(&bridge, &source, &unsaved, "number").await;
            assert_eq!(std::fs::read_to_string(&source).unwrap(), original);
            bridge.shutdown().await.unwrap();
        });
        std::fs::write(
            &base,
            policy.replace("\"strictNullChecks\":true", "\"strictNullChecks\":false"),
        )
        .unwrap();
        let repaired = std::sync::Arc::new(
            CompilerConfigurationSnapshot::capture(root.path(), Some(&config)).unwrap(),
        );
        let next = CorsaBridge::with_compiler_configuration(
            CorsaBridgeConfig {
                corsa_path: native.clone(),
                working_dir: Some(root.path().to_path_buf()),
                tsconfig_path: Some(config),
                ..Default::default()
            },
            Default::default(),
            Some(repaired),
        );
        corsa::runtime::block_on(async {
            next.spawn().await.unwrap();
            assert_typed_hover(&next, &source, original, "string").await;
            next.shutdown().await.unwrap();
        });
    }
}
