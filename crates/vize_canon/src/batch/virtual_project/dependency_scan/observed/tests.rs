use super::{Consumed, FactOwner, FactRole, InputStamp, WalkFacts};
use std::{io::ErrorKind, path::Path, sync::Arc};

fn owned_facts() -> Vec<InputStamp> {
    vec![
        InputStamp::observed_source("/owned/tsconfig.json".into(), b"configuration")
            .with_owner(Arc::new(FactOwner {
                path: "/owned/configuration".into(),
                role: FactRole::Configuration,
            })),
        InputStamp::observed_source("/owned/source.ts".into(), b"authored").with_owner(
            Arc::new(FactOwner {
                path: "/owned/source.ts".into(),
                role: FactRole::AuthoredSource,
            }),
        ),
        InputStamp::observed_canonical_file(
            "/owned/probe.ts".into(),
            "/owned/selected.ts".into(),
            true,
        )
        .with_owner(Arc::new(FactOwner {
            path: "/owned/importer.vue".into(),
            role: FactRole::LocalImporter,
        })),
    ]
}

#[test]
fn aliases_preserve_complete_owned_facts_and_default_only_unowned_facts() {
    let root = Path::new("/current/project");
    let aliases = vec![("@/*".into(), "./src/*".into())];
    let mut input = owned_facts();
    let unowned = InputStamp::observed_read_failure(
        "/current/missing-config.json".into(),
        ErrorKind::NotFound,
    );
    input.push(unowned.clone());
    let mut expected = owned_facts();
    expected.push(unowned.with_owner(Arc::new(FactOwner {
        path: root.to_path_buf(),
        role: FactRole::Configuration,
    })));
    for qualified in [true, false] {
        let (actual_aliases, facts) = WalkFacts::from_aliases(
            Consumed {
                value: aliases.clone(),
                stamps: input.clone(),
                qualified,
            },
            root,
        );
        assert_eq!(actual_aliases, aliases);
        let result = facts.finish();
        assert_eq!(result.stamps, expected);
        assert_eq!(result.qualified, qualified);
        assert!(result.value.is_empty());
    }
}

#[test]
fn importer_append_preserves_complete_owned_facts_order_and_qualification() {
    let root = Path::new("/current/project");
    let importer = Path::new("/current/importer.vue");
    let (_, mut facts) = WalkFacts::from_aliases(
        Consumed {
            value: Vec::new(),
            stamps: Vec::new(),
            qualified: true,
        },
        root,
    );
    facts.begin_importer(importer, Some(b"actual authored importer"));
    let mut input = owned_facts();
    let unowned = InputStamp::observed_is_file("/current/target.ts".into(), false);
    input.push(unowned.clone());
    assert!(facts.package_result(Consumed {
        value: true,
        stamps: input,
        qualified: false,
    }));
    facts.complete(importer);
    let after = InputStamp::observed_exists("/current/package.json".into(), false);
    assert!(!facts.package_result(Consumed {
        value: false,
        stamps: vec![after.clone()],
        qualified: true,
    }));
    let mut expected = vec![
        InputStamp::observed_source(importer.to_path_buf(), b"actual authored importer")
            .with_owner(Arc::new(FactOwner {
                path: importer.to_path_buf(),
                role: FactRole::AuthoredSource,
            })),
    ];
    expected.extend(owned_facts());
    expected.push(unowned.with_owner(Arc::new(FactOwner {
        path: importer.to_path_buf(),
        role: FactRole::LocalImporter,
    })));
    expected.push(after.with_owner(Arc::new(FactOwner {
        path: root.to_path_buf(),
        role: FactRole::Configuration,
    })));
    let result = facts.finish();
    assert_eq!(result.stamps, expected);
    assert_eq!(result.value, vec![importer.to_path_buf()]);
    assert!(!result.qualified);
}

#[test]
fn disabled_append_keeps_complete_facts_without_inventing_an_owner() {
    let mut facts = WalkFacts::disabled();
    let mut input = owned_facts();
    input.push(InputStamp::observed_metadata_len(
        "/unowned/input.json".into(),
        Ok(17),
    ));
    assert_eq!(
        facts.append(Consumed {
            value: 17,
            stamps: input.clone(),
            qualified: true,
        }),
        17
    );
    let result = facts.finish();
    assert_eq!(result.stamps, input);
    assert!(result.value.is_empty());
    assert!(!result.qualified);
}
