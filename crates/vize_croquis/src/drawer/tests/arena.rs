use super::super::{Drawer, DrawerOptions};

#[test]
fn reused_script_arena_keeps_owned_croquis_debug_after_reset() {
    let sources = [
        "const props = defineProps<{ title: string }>(); const emit = defineEmits<{ '🦀:submit': [value: string] }>(); defineSlots<{ default(props: { title: string }): unknown }>();",
        "interface Base { inherited: string } interface Props extends Base { count: number } const props = defineProps<Props>(); const doubled = computed(() => props.count * 2);",
        "const emit = defineEmits(['change', 'update:modelValue']); const state = ref(0); watch(state, async () => { await Promise.resolve(); state.value++; });",
        "const broken = ; defineEmits<{ recovered: [] }>();",
        "const view = <div />; defineSlots<{ rejected(): unknown }>();",
        "",
    ];
    for options in [
        DrawerOptions::default(),
        DrawerOptions {
            analyze_script: true,
            ..Default::default()
        },
        DrawerOptions::full(),
    ] {
        let mut allocator = oxc_allocator::Allocator::default();
        let mut retained = Vec::new();
        for source in sources {
            let mut fresh = Drawer::with_options(options).with_unused_bindings();
            fresh.draw_script_setup(source);
            let fresh = fresh.finish();
            let mut reused = Drawer::with_options(options).with_unused_bindings();
            reused.draw_script_setup_in(source, &allocator);
            let reused = reused.finish();
            allocator.reset();
            retained.push((fresh, reused));
        }
        for (fresh, reused) in retained {
            assert_eq!(format!("{fresh:?}"), format!("{reused:?}"));
        }
    }
}
