use super::{is_vue_runtime_support_specifier as is_support, route_requires_invalidation_binding};

#[test]
fn generated_runtime_support_filter_is_exact() {
    for specifier in [
        "vue",
        "vue/dist/vue.cjs.js",
        "vue/server-renderer",
        "vue/jsx-runtime",
        "@vue/runtime-core",
        "@vue/runtime-dom",
        "vite/client",
    ] {
        assert!(is_support(specifier), "{specifier}");
    }
    for specifier in [
        "vue-router",
        "@vueuse/core",
        "@vue",
        "vite",
        "vite/plugin-vue",
    ] {
        assert!(!is_support(specifier), "{specifier}");
    }
}

#[test]
fn positive_non_vue_routes_keep_an_invalidation_binding() {
    assert!(route_requires_invalidation_binding(true, false));
    assert!(route_requires_invalidation_binding(false, true));
    assert!(!route_requires_invalidation_binding(false, false));
}
