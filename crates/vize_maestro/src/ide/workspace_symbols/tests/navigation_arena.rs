use super::super::WorkspaceSymbolsService;
use tower_lsp::lsp_types::Url;

#[test]
fn navigation_arena_returns_owned_complete_symbols_across_source_resets() {
    let sources = [
        (
            "Component.vue",
            "<script setup lang=\"ts\">const café = 1; defineEmits<{ 'save-item': [value: string] }>(); defineSlots<{ default(): unknown }>();</script>\n<style>.active { color: red }</style>",
        ),
        (
            "module.ts",
            "/* 🦀 */ export function café() {}\r\nexport const value = 1;\r\nexport interface Props { value: string }",
        ),
        ("view.tsx", "export const View = () => <div>🦀</div>;"),
        (
            "component.js",
            "export class Component {}\nexport const createdLifecycleProbe = 1;",
        ),
        (
            "Broken.vue",
            "<script setup>const broken = ; defineEmits<{ recovered: [] }>();</script>",
        ),
        (
            "Duplicate.vue",
            "<template>one</template><template>two</template>",
        ),
        ("invalid.ts", "export const counterfeit = ;"),
        (
            "External.vue",
            "<script src=\"./module.ts\"></script><template lang=\"pug\">div</template>",
        ),
        (
            "Empty.vue",
            "<template></template><script setup></script><style scoped></style>",
        ),
    ];
    for query in [
        "",
        "café",
        "save-item",
        "default",
        "createdLifecycleProbe",
        "absent",
    ] {
        let mut arena = vize_l0::Allocator::default();
        let mut fresh = Vec::new();
        let mut reused = Vec::new();
        for (filename, source) in sources {
            let uri = Url::parse(&format!("file:///workspace/{filename}")).unwrap();
            WorkspaceSymbolsService::collect_source(&uri, source, query, &mut fresh);
            arena.reset();
            WorkspaceSymbolsService::collect_source_in(&uri, source, query, &mut reused, &arena);
        }
        arena.reset();
        assert_eq!(
            serde_json::to_value(fresh).unwrap(),
            serde_json::to_value(reused).unwrap(),
        );
    }
}
