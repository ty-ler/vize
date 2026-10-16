//! Canonical Vite carrier for native CLI configuration fixtures.
#![allow(dead_code)]
#![expect(clippy::disallowed_macros, reason = "test fixture carrier text")]
#![expect(clippy::disallowed_types, reason = "test fixture carrier text")]

use std::path::{Path, PathBuf};

pub fn source(config: impl AsRef<[u8]>) -> String {
    let mut native: serde_json::Value =
        serde_json::from_slice(config.as_ref()).expect("native fixture config JSON");
    let options = native
        .as_object_mut()
        .expect("native fixture config object");
    if let Some(vue) = options.remove("vue") {
        for (key, value) in vue.as_object().expect("native Vue config") {
            assert!(
                options.insert(key.clone(), value.clone()).is_none(),
                "duplicate Vue setting: {key}"
            );
        }
    }
    if let Some(lsp) = options.remove("lsp") {
        assert!(
            options.insert("languageServer".into(), lsp).is_none(),
            "duplicate languageServer settings"
        );
    }
    format!("export default {{ vue: {native} }};\n")
}

pub fn write(root: &Path, config: impl AsRef<[u8]>) -> PathBuf {
    let path = root.join("vite.config.mjs");
    std::fs::write(&path, source(config)).expect("Vite config fixture");
    path
}
