//! Preserve every native diagnostic, including explicit unmapped spans.
#![expect(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    reason = "complete seven-field diagnostic vectors"
)]

use crate::{
    batch::virtual_project::VirtualFile, corsa_client::LspDiagnostic, file_uri::file_uri_to_path,
};
use std::{fs, path::Path};

pub(super) type Row = (
    String,
    Option<u32>,
    Option<u32>,
    Option<u32>,
    Option<u32>,
    Option<i32>,
    String,
);

pub(super) fn map(
    root: &Path,
    files: &[&VirtualFile],
    raw: &[(vize_l0::String, Vec<LspDiagnostic>)],
) -> Vec<Row> {
    let mut result = Vec::new();
    for (uri, diagnostics) in raw {
        let path = file_uri_to_path(uri).unwrap();
        let file = files.iter().find(|file| file.virtual_path == path).unwrap();
        let source = fs::read_to_string(&file.original_path).unwrap();
        for diagnostic in diagnostics {
            let offset = |position: &crate::corsa_client::LspPosition| {
                crate::batch::source_map::line_col_to_offset(
                    file.content.as_str(),
                    position.line,
                    position.character,
                )
                .and_then(|offset| {
                    file.source_map
                        .get_original_position(offset)
                        .map(|value| value.0)
                })
            };
            let start = offset(&diagnostic.range.start);
            let end = offset(&diagnostic.range.end);
            let location = start
                .and_then(|offset| crate::batch::source_map::offset_to_line_col(&source, offset));
            let length = start
                .zip(end)
                .and_then(|(start, end)| end.checked_sub(start));
            let code = diagnostic.code.as_ref().and_then(|code| {
                code.as_u64()
                    .and_then(|code| u32::try_from(code).ok())
                    .or_else(|| code.as_str().and_then(|code| code.parse().ok()))
            });
            result.push((
                file.original_path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                location.map(|value| value.0),
                location.map(|value| value.1),
                length,
                code,
                diagnostic.severity,
                diagnostic.message.to_string(),
            ));
        }
    }
    result.sort();
    result
}
