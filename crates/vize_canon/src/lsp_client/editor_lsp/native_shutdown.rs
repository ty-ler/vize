//! Native 7.0.2 shutdown capability, bound to actual binary and initialize bytes.

use corsa_lsp::{LspClient, process::ProcessObserver};
use lsp_types::request::Shutdown;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const LINUX_X64: &str = "4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4";
const DARWIN_ARM64: &str = "a82f731365ad69d5c4c15f5e18fba4584bf3b7b839960172a76c3462b5114bf2";

#[cfg(target_os = "linux")]
mod owned_image;

pub(super) fn eof_capability(
    executable: &Path,
    initialized: &Value,
    observer: &ProcessObserver,
) -> bool {
    if !known_initialize(initialized) {
        return false;
    }
    if let Ok(bytes) = fs::read(executable) {
        let digest: vize_l0::String = Sha256::digest(bytes)
            .iter()
            .map(|byte| vize_l0::cstr!("{byte:02x}"))
            .collect();
        if known_binary(digest.as_str()) {
            return true;
        }
    }
    #[cfg(target_os = "linux")]
    return owned_image::eof_capability(observer);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = observer;
        false
    }
}

pub(super) async fn close(client: &LspClient, shutdown_to_eof: bool) -> corsa_lsp::Result<()> {
    if !shutdown_to_eof {
        return client.graceful_close().await;
    }
    // Unit result decoding requires the actual null Shutdown acknowledgement.
    // Always close/reap even after a protocol error, retaining that first error.
    // Sending Exit races native 7.0.2's Shutdown and can emit EOF/context canceled.
    let acknowledged = client.request_without_params::<Shutdown>().await;
    let closed = client.close().await;
    acknowledged.and(closed)
}

fn known_initialize(initialized: &Value) -> bool {
    *initialized == known_contract()
}

fn known_contract() -> Value {
    serde_json::json!({
        "capabilities": {
            "_vs_onAutoInsertProvider": {
                "_vs_triggerCharacters": [
                    ">"
                ]
            },
            "_vs_referencesProvider": true,
            "callHierarchyProvider": true,
            "codeActionProvider": {
                "codeActionKinds": [
                    "quickfix",
                    "source.organizeImports",
                    "source.removeUnusedImports",
                    "source.sortImports",
                    "source.fixAll"
                ]
            },
            "codeLensProvider": {
                "resolveProvider": true
            },
            "completionProvider": {
                "completionItem": {
                    "labelDetailsSupport": true
                },
                "resolveProvider": true,
                "triggerCharacters": [
                    ".",
                    "\"",
                    "'",
                    "`",
                    "/",
                    "@",
                    "<",
                    "#",
                    " ",
                    "*"
                ]
            },
            "definitionProvider": true,
            "diagnosticProvider": {
                "identifier": "typescript",
                "interFileDependencies": true,
                "workspaceDiagnostics": false
            },
            "documentFormattingProvider": true,
            "documentHighlightProvider": true,
            "documentOnTypeFormattingProvider": {
                "firstTriggerCharacter": "{",
                "moreTriggerCharacter": [
                    "}",
                    ";",
                    "\n"
                ]
            },
            "documentRangeFormattingProvider": true,
            "documentSymbolProvider": true,
            "experimental": {
                "customMultiDocumentHighlightProvider": true,
                "customSourceDefinitionProvider": true
            },
            "foldingRangeProvider": true,
            "hoverProvider": true,
            "implementationProvider": true,
            "inlayHintProvider": true,
            "linkedEditingRangeProvider": true,
            "positionEncoding": "utf-16",
            "referencesProvider": true,
            "renameProvider": {
                "prepareProvider": true
            },
            "selectionRangeProvider": true,
            "semanticTokensProvider": {
                "full": true,
                "legend": {
                    "tokenModifiers": [],
                    "tokenTypes": []
                },
                "range": true
            },
            "signatureHelpProvider": {
                "retriggerCharacters": [
                    ")"
                ],
                "triggerCharacters": [
                    "(",
                    ",",
                    "<"
                ]
            },
            "textDocumentSync": {
                "change": 2,
                "openClose": true,
                "save": true
            },
            "typeDefinitionProvider": true,
            "workspace": {
                "fileOperations": {
                    "willRename": {
                        "filters": [
                            {
                                "pattern": {
                                    "glob": "**/*.{ts,tsx,js,jsx,cts,cjs,mts,mjs,json}"
                                },
                                "scheme": "file"
                            }
                        ]
                    }
                }
            },
            "workspaceSymbolProvider": true
        },
        "serverInfo": {
            "name": "typescript-go",
            "version": "7.0.2"
        }
    })
}

fn known_binary(digest: &str) -> bool {
    matches!(digest, LINUX_X64 | DARWIN_ARM64)
}

#[cfg(test)]
mod tests;
