use std::borrow::Cow;

use super::super::sources::borrowed_descriptor;

#[test]
fn complete_borrowed_descriptors_match_the_original_owned_parser() {
    let sources = [
        "<script setup lang=\"ts\">\r\nconst café = 1\r\n</script>",
        "<template><div>🦀</div></template>\n<script>export default {}</script>",
        "<script setup>defineEmits(['save-item', 'update:modelValue'])</script>",
        "<script setup lang=\"ts\">defineSlots<{ default(): unknown }>()</script>",
        "<style scoped>.active { color: v-bind(color) }</style>\n<docs lang=\"md\">Guide</docs>",
        "<script src=\"./outside.ts\"></script>\n<template lang=\"pug\">div</template>",
        "<template></template>\n<script setup></script>\n<style module=\"theme\"></style>",
    ];
    for source in sources {
        let borrowed = borrowed_descriptor("/workspace/Probe.vue", source).unwrap();
        let original = vize_incremental::parse_descriptor("/workspace/Probe.vue", source).unwrap();
        assert!(matches!(borrowed.source, Cow::Borrowed(_)));
        assert_eq!(borrowed.source.as_ptr(), source.as_ptr());
        assert_eq!(
            serde_json::to_value(&borrowed).unwrap(),
            serde_json::to_value(&*original).unwrap(),
        );
    }
}

#[test]
fn malformed_and_duplicate_blocks_keep_the_original_parse_refusal() {
    for source in [
        "<template><div></template>",
        "<script setup>const count = 1",
        "<template>one</template><template>two</template>",
        "<script>one</script><script>two</script>",
    ] {
        assert_eq!(
            borrowed_descriptor("/workspace/Probe.vue", source).is_some(),
            vize_incremental::parse_descriptor("/workspace/Probe.vue", source).is_some(),
        );
    }
}
