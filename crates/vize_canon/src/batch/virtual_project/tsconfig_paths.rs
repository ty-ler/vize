//! Path and JSONC utilities for tsconfig handling: resolving `extends` targets,
//! lexical path normalization, re-anchoring `paths` aliases, and a minimal
//! JSON-with-comments parser used to read user tsconfigs.

use std::path::{Path, PathBuf};

use serde_json::Value;
use vize_carton::String as CompactString;

use crate::batch::error::CorsaResult;

mod extends;
pub(crate) use extends::{resolve_extended_tsconfig_path, resolve_extended_tsconfig_path_observed};

pub(super) fn normalize_tsconfig_path_target(
    base_dir: &Path,
    project_root: &Path,
    target: &str,
) -> CompactString {
    let normalized = normalize_path_lexically(&base_dir.join(target));
    if let Ok(relative) = normalized.strip_prefix(project_root) {
        return path_to_tsconfig_target(relative);
    }
    path_to_tsconfig_target(&normalized)
}

fn path_to_tsconfig_target(path: &Path) -> CompactString {
    path.to_string_lossy().replace('\\', "/").into()
}

pub(super) fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

pub(crate) fn parse_jsonc_value(content: &str) -> CorsaResult<Value> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let stripped = strip_json_comments(content);
    let normalized = strip_trailing_commas(&stripped);
    Ok(serde_json::from_str(&normalized)?)
}

pub(super) fn strip_json_comments(content: &str) -> CompactString {
    let mut output = CompactString::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;

    while let Some(ch) = chars.next() {
        if line_comment {
            if ch == '\n' {
                line_comment = false;
                output.push('\n');
            }
            continue;
        }

        if block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                let _ = chars.next();
                block_comment = false;
            } else if ch == '\n' {
                output.push('\n');
            }
            continue;
        }

        if in_string {
            output.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            output.push(ch);
            continue;
        }

        if ch == '/' && chars.peek() == Some(&'/') {
            let _ = chars.next();
            line_comment = true;
            continue;
        }

        if ch == '/' && chars.peek() == Some(&'*') {
            let _ = chars.next();
            block_comment = true;
            continue;
        }

        output.push(ch);
    }

    output
}

fn strip_trailing_commas(content: &str) -> CompactString {
    let mut output = CompactString::with_capacity(content.len());
    let chars: Vec<char> = content.chars().collect();
    let mut index = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while let Some(&ch) = chars.get(index) {
        if in_string {
            output.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            output.push(ch);
            index += 1;
            continue;
        }

        if ch == ',' {
            let mut lookahead = index + 1;
            while chars
                .get(lookahead)
                .is_some_and(|next| next.is_whitespace())
            {
                lookahead += 1;
            }
            if chars
                .get(lookahead)
                .is_some_and(|next| matches!(next, '}' | ']'))
            {
                index += 1;
                continue;
            }
        }

        output.push(ch);
        index += 1;
    }

    output
}

#[cfg(test)]
#[path = "tsconfig_paths/bom_tests.rs"]
mod bom_tests;
