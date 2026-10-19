use crate::linter::Linter;

const RULE: &str = "script/no-deprecated-delete-set";

fn findings(source: &str) -> Vec<&str> {
    let linter = Linter::new().with_enabled_rules(Some(vec![RULE.into()]));
    let result = linter.lint_sfc(source, "Test.vue");
    result
        .diagnostics
        .iter()
        .map(|diagnostic| {
            assert_eq!(
                diagnostic.message.as_str(),
                "The `$delete`, `$set` is deprecated."
            );
            source
                .get(diagnostic.start as usize..diagnostic.end as usize)
                .unwrap_or_default()
        })
        .collect()
}

#[test]
fn instance_and_global_apis_in_components() {
    let source = "<script>\nimport Vue from 'vue'\nexport default {\n  methods: {\n    update() {\n      this.$set(this.user, 'name', 'Ada')\n      this.$delete(this.user, 'age')\n      Vue.set(this.list, 0, 1)\n      Vue.delete(this.list, 0)\n    },\n  },\n}\n</script>\n";
    assert_eq!(findings(source), ["$set", "$delete", "set", "delete"]);
}

#[test]
fn define_component_and_vue_component_are_components() {
    let source = "<script lang=\"ts\">\nimport { defineComponent } from 'vue'\nconst A = defineComponent({ methods: { a() { this.$set(o, 'k', 1) } } })\nVue.component('b', { methods: { b() { this.$delete(o, 'k') } } })\nexport default A\n</script>\n";
    assert_eq!(findings(source), ["$set", "$delete"]);
}

#[test]
fn imported_set_and_del_are_reported_anywhere() {
    let source = "<script setup>\nimport { set, del as remove } from 'vue'\nset(state, 'a', 1)\nremove(state, 'a')\nVue.set(state, 'b', 2)\n</script>\n";
    assert_eq!(findings(source), ["set", "remove", "set"]);
}

#[test]
fn outside_components_and_plain_assignments_are_allowed() {
    let source = "<script>\nconst helper = { run() { this.$set(a, 'b', 1) } }\nexport default {\n  methods: {\n    update() {\n      this.user.name = 'Ada'\n      delete this.user.age\n      this.set(1)\n    },\n  },\n}\n</script>\n";
    assert!(findings(source).is_empty());
}
