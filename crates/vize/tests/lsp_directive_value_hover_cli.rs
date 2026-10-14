#![cfg(test)]
#![expect(clippy::disallowed_macros, reason = "fixtures use std strings")]
#![expect(clippy::disallowed_types, reason = "fixtures use std strings")]
//! `v-html` and `v-text` values are template expressions the checker types,
//! like every other directive value (#9110).
use serde_json::Value;

#[path = "support/lsp_process.rs"]
mod lsp_process;
#[path = "support/lsp_vue_project.rs"]
mod support;
use support::Fixture;

const APP: &str = "<script setup lang=\"ts\">
import { computed, ref } from \"vue\";
const html = ref(\"<b>a</b>\");
const text = computed(() => \"plain\");
const shown = ref(true);
</script>

<template>
  <div v-html=\"html\" />
  <p v-text=\"text\" />
  <span v-show=\"shown\">{{ text }}</span>
</template>
";

fn hover(fixture: &mut Fixture, needle: &str) -> String {
    let result: Value = fixture.request("textDocument/hover", APP, needle);
    result["contents"]["value"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

#[test]
fn v_html_and_v_text_values_hover_with_their_checker_types() {
    let mut fixture = Fixture::new_with_vue(APP);
    fixture.open(APP);
    for (needle, expected) in [
        ("html\" />", "const html: string"),
        ("text\" />", "const text: string"),
        ("shown\">", "const shown: boolean"),
    ] {
        let contents = hover(&mut fixture, needle);
        assert!(
            contents.contains(expected),
            "hover on {needle:?} must contain {expected:?}, got {contents:?}"
        );
        assert!(!contents.contains("Template binding"), "{contents}");
    }
    fixture.shutdown();
}
