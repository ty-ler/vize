//! Shared parent guards must not erase the exclusions of a nested branch chain.
#![expect(clippy::disallowed_macros, reason = "fixtures use std strings")]
#![expect(clippy::disallowed_types, reason = "fixtures use std strings")]

#[path = "support/script_block_project.rs"]
mod project;

macro_rules! fixture {
    ($file:literal) => {
        include_str!(concat!(
            "../../../tests/_fixtures/differential/typechecker/nested-branch-chain/",
            $file,
            ".txt"
        ))
    };
}

fn check(child: &str) -> Vec<String> {
    project::check(&[
        ("src/Command.vue", fixture!("Command.vue")),
        ("src/Notification.vue", fixture!("Notification.vue")),
        ("src/User.vue", fixture!("User.vue")),
        ("src/Child.vue", child),
        ("src/Paginator.vue", fixture!("Paginator.vue")),
        ("src/types.ts", fixture!("types.ts")),
    ])
}

#[test]
fn nested_else_keeps_v_for_slot_and_nullable_prop_narrowing() {
    assert_eq!(check(fixture!("Child.vue")), Vec::<String>::new());
}

#[test]
fn nested_else_keeps_real_prop_type_errors() {
    for (before, after, file, count) in [
        ("cmd?: string", "cmd?: number", "Command.vue", 1),
        (
            "notification?: Notification",
            "notification?: number",
            "Notification.vue",
            2,
        ),
        ("user?: User", "user?: number", "User.vue", 1),
    ] {
        let child = fixture!("Child.vue").replace(before, after);
        let rows = check(&child);
        assert_eq!(rows.len(), count, "{file}: {rows:#?}");
        assert!(
            rows.iter().all(|row| {
                row.starts_with(&format!("src/{file}(")) && row.contains("error TS2322:")
            }),
            "{file}: {rows:#?}"
        );
    }
}
