//! Native EOF shutdown capability, bound to whole binary/initialize pairs.

use corsa_lsp::{LspClient, process::ProcessObserver};
use lsp_types::request::Shutdown;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

const LINUX_X64: &str = "4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4";
const DARWIN_ARM64: &str = "a82f731365ad69d5c4c15f5e18fba4584bf3b7b839960172a76c3462b5114bf2";

// Exact upstream d6c4afdd, Go 1.26.6 linux/amd64, noembed and trimpath.
// Whole image and initialize evidence: Content Mapper run 39124809180.
const CONTENT_MAPPER_D6C_LINUX_X64: &str =
    "77dd575e73107c00cc95cbccc3764ab7210089b5634f75e219b61632bd5d230b";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EofContract {
    Native702,
    ContentMapperD6c,
}

impl EofContract {
    fn accepts_image(self, digest: &str) -> bool {
        match self {
            Self::Native702 => known_binary(digest),
            Self::ContentMapperD6c => digest == CONTENT_MAPPER_D6C_LINUX_X64,
        }
    }
}

fn eof_contract(initialized: &Value) -> Option<EofContract> {
    if known_initialize(initialized) {
        Some(EofContract::Native702)
    } else if content_mapper_contract().as_ref() == Some(initialized) {
        Some(EofContract::ContentMapperD6c)
    } else {
        None
    }
}

fn content_mapper_contract() -> Option<Value> {
    // Build only the trusted expected response. Incoming responses are never
    // normalized: every capability and all metadata must match the whole pair.
    let mut expected = known_contract();
    let server_info = expected.get_mut("serverInfo")?;
    *server_info = serde_json::json!({
        "name": "typescript",
        "version": "7.1.0-dev"
    });
    Some(expected)
}

#[cfg(target_os = "linux")]
mod owned_image;

pub(super) fn eof_capability(
    executable: &Path,
    initialized: &Value,
    observer: &ProcessObserver,
) -> bool {
    let Some(contract) = eof_contract(initialized) else {
        return false;
    };
    if let Ok(digest) = File::open(executable).and_then(image_digest) {
        let digest: vize_l0::String = digest
            .iter()
            .map(|byte| vize_l0::cstr!("{byte:02x}"))
            .collect();
        if contract.accepts_image(digest.as_str()) {
            return true;
        }
    }
    #[cfg(target_os = "linux")]
    return owned_image::eof_capability(observer, contract);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = observer;
        false
    }
}

fn image_digest(mut image: impl Read) -> io::Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        match image.read(&mut buffer) {
            Ok(0) => return Ok(hasher.finalize().into()),
            Ok(count) => hasher.update(buffer.get(..count).ok_or(io::ErrorKind::InvalidData)?),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
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
