use super::*;
use crate::pr_pin::tests::{Repo, source};

#[test]
fn published_history_needs_the_original_annotated_tag_before_any_catalog_exception() {
    let repo = Repo::new();
    let cut = repo.commit(&[("Cargo.toml", "[workspace.package]\nversion = \"1.2.2\"\n")]);
    let head = repo.commit(&[("Cargo.toml", "[workspace.package]\nversion = \"1.2.3\"\n")]);
    let source = source(&head, &cut);
    assert!(
        published_history(&source, 7, &repo.work)
            .unwrap_err()
            .contains("tag")
    );
    let receipt = Receipt {
        head: head.clone(),
        merge: cut.clone(),
        parent: cut.clone(),
        gate: cut,
    };
    super::super::tags::ensure_local_tag(&source, 7, &receipt, &repo.work).unwrap();
    push_tag(&repo.work, "refs/tags/v1.2.3").unwrap();
    let before = github::git(&["ls-remote", "--refs", "origin"], &repo.work).unwrap();
    assert!(
        published_history(&source, 8, &repo.work)
            .unwrap_err()
            .contains("another original")
    );
    assert_eq!(
        before,
        github::git(&["ls-remote", "--refs", "origin"], &repo.work).unwrap()
    );
}

#[test]
fn historical_catalog_drift_does_not_relax_promotion_or_original_delivery() {
    let repo = Repo::new();
    repo.commit(&[
        ("Cargo.toml", "[workspace]\nmembers = [\"pkg\"]\nresolver = \"2\"\n[workspace.package]\nversion = \"1.2.3\"\nedition = \"2024\"\n"),
        ("pkg/Cargo.toml", "[package]\nname = \"vize_law\"\nversion.workspace = true\nedition.workspace = true\n"),
        ("pkg/src/lib.rs", "pub fn law() {}\n"),
        ("npm/law/package.json", "{\"name\":\"vize-law\",\"version\":\"1.2.3\",\"exports\":\"./index.mjs\"}\n"),
        ("pnpm-workspace.yaml", "catalogs:\n  native-binaries:\n    \"@vizejs/native-test\": \"1.2.3\"\n"),
        ("tools/support/release/publish_crates/main.ts", "let published_crates = [\"vize_law\"]\n"),
        (".github/workflows/release.yml", "publish the original qualified artifacts\n"),
        ("tools/commands/ci/github/release-platforms.rs", "native-test\n"),
        ("tools/support/release/publish_npm_package_dirs/main.ts", "publish native directories\n"),
        ("tools/support/release/publish_npm_package/main.ts", "publish exact package version\n"),
    ]);
    github::output("cargo", &["generate-lockfile", "--offline"], &repo.work).unwrap();
    let head = repo.commit(&[]);
    let delivery = repo.commit(&[(
        "pkg/src/lib.rs",
        "pub fn law() { /* ordinary predecessor */ }\n",
    )]);
    let source = source(&head, &head);
    let original = registry_catalog(&source, &delivery, &delivery, false, &repo.work).unwrap();
    let current = repo.commit(&[(
        ".github/workflows/release.yml",
        "publish reviewed newer workflow\n",
    )]);
    assert!(registry_catalog(&source, &delivery, &current, false, &repo.work).is_err());
    assert_eq!(
        original,
        registry_catalog(&source, &delivery, &current, true, &repo.work).unwrap()
    );
    // Moving-main independence cannot substitute a different publication
    // manifest in V, even if that different manifest is also current main.
    let changed_delivery = repo.commit(&[(
        "npm/law/package.json",
        "{\"name\":\"vize-law\",\"version\":\"1.2.3\",\"exports\":\"./changed.mjs\"}\n",
    )]);
    for published in [false, true] {
        assert!(
            registry_catalog(
                &source,
                &changed_delivery,
                &changed_delivery,
                published,
                &repo.work
            )
            .is_err()
        );
    }
}
