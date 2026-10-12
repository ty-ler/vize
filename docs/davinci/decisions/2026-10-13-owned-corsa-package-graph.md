# Owned Corsa packages for external Canon consumers

Canon's default native feature must compile outside the Vize workspace.
The actual CSS downstream consumer on source `97f3db6d` instead resolved
registry Corsa 1.14.0, which lacks the checked `ProcessObserver`,
`ProcessReceipt` and `with_process_observer` APIs. Cargo patches in a
dependency's workspace root do not apply to an independent consumer.
Successful workspace compilation therefore did not qualify this surface.

## Package graph and public types

Keep the complete checked dependency graph under Vize's package names:

| Existing dependency key and library | Published package         |
| ----------------------------------- | ------------------------- |
| `corsa_core`                        | `vize_corsa_core`         |
| `corsa_jsonrpc`                     | `vize_corsa_jsonrpc`      |
| `corsa_client`                      | `vize_corsa_client`       |
| `corsa_lsp`                         | `vize_corsa_lsp`          |
| `corsa_orchestrator`                | `vize_corsa_orchestrator` |
| `corsa`                             | `vize_corsa`              |

These six packages inherit Vize's workspace version and use exact versioned
workspace aliases. All internal core, client, JSON-RPC, LSP and orchestrator
edges resolve to this graph. `corsa_runtime = =1.14.0` remains the independent
registry runtime. It has no dependency on the core error or command types.
Library names, exports, facade defaults and the `experimental-distributed`
feature forwarding remain unchanged. The two Corsa registry patches are
replaced by ordinary package dependencies.

This is a next-minor nominal Rust API migration. Values from separately
imported registry Corsa packages are different Rust types. A preserved
source-spelled import is insufficient to establish interoperability.
Consumers that directly share those values with Canon must use the checked
packages consistently, for example:

```toml
[dependencies]
# Select the same published Vize release for both dependencies.
vize_canon = "=0.443.0"
corsa = { package = "vize_corsa", version = "=0.443.0" }
```

The versions above describe the preparation source. They do not assert
that the new packages are already available on the public registry. The
release must document its actual next-minor version and migration before
publication. These packages carry `compatibility-preview` stability metadata.

## Source and packaging custody

Retain the complete authenticated published 1.14.0 members of all six
packages, including original manifests and VCS records. Existing checked
core/LSP production bodies remain unchanged. The other four source trees
are imported from their checksum-authenticated published archives. Their
MIT notice is copied byte-for-byte from the authenticated upstream core
license and retained in every packaged tree.

Cargo reserves `.cargo_vcs_info.json` and `Cargo.toml.orig`. Explicitly
exclude those original files from package input while keeping them in the
repository; Cargo generates the checked package's own metadata. Original
archive identity and resulting package identity are distinct authorities.
The archive VCS field is archive-authenticated metadata, rather than proof
that a separate Git checkout was reconstructed.

The supported `cargo update --workspace --offline` resolver keeps 579
package records: 570 unrelated whole records remain identical, six package
identities change, and three Vize consumer dependency lists use the checked
names. The facade's existing `tempfile` dev dependency and orchestrator's
existing optional `lsp-types` edge are now represented as workspace member
dependencies. The runtime's complete record remains unchanged.

Actual `cargo package --no-verify` generated all six archives. This proves
package assembly and normalization only. It does not prove consumer
compilation, native lifecycle correctness or installed public acceptance.

## Required delivery

Qualify an independent Cargo root without consumer patches, with Canon's
default native feature and both facade feature modes. Authenticate the
complete normalized packaged graph and compile the sealed package consumer
separately. Keep every original SDK source, raw native lifecycle/refusal,
owned-image, original400, differential and protected check mandatory.
Partial, foreign, mixed and unknown package source contexts must refuse
before recording benchmark results. These wiring changes make no speed or
broader real-project diagnostic claim.

Publish in dependency order: core, JSON-RPC, client, LSP, orchestrator,
facade, then Canon. New package ownership/trusted publishing and actual
registry propagation are release prerequisites. After publication, compile
the same consumer from the public registry. A sealed local graph or a
source review does not substitute for that acceptance. The original CSS
consumer failure and all failed source-custody packets remain retained.

The current source successor preserves the complete actual `2489128d` baseline and all 237 production pairs (121 original, 112 imported members and four license copies). Both complete caller bodies qualify before the private whole historical source view is available; the original 121/122/23/2 tables, seven native fixture bodies and 32 requests remain mandatory. The original 206 copied-source census remains distinct from the explicit complete 359-member owned graph capture. Splitting the four unchanged literal plan arrays keeps the formatted metadata helper under 350 rows; a missing or changed plan refuses before source projection. Eleven source/caller/Git-reader laws pass locally; the six copied-source laws require a committed source and their hosted runtime/package evidence remains pending. No source receipt grants compiler, native, performance, protected merge or registry acceptance.
