//! Workspace-wide symbol search for Vue components, script bindings, and styles.
#![expect(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    clippy::disallowed_macros,
    reason = "tower-lsp SymbolInformation takes std String names built with format!/to_string"
)]

#[cfg(feature = "native")]
mod disk;
mod rank;
#[cfg(feature = "native")]
mod script;
mod sources;
#[cfg(test)]
mod tests;
mod vue;

use tower_lsp::lsp_types::{Location, Position, Range, SymbolInformation, SymbolKind, Url};

use crate::server::ServerState;

/// Workspace symbols service.
pub struct WorkspaceSymbolsService;

impl WorkspaceSymbolsService {
    /// Search for symbols matching a query.
    pub fn search(state: &ServerState, query: &str) -> Vec<SymbolInformation> {
        let mut symbols = Vec::new();
        let query_lower = query.to_lowercase();

        // Search in all open documents. Snapshot the text before parsing so a
        // workspace-wide request never keeps a DashMap document guard alive
        // while doing SFC work (#3952).
        for (uri, content) in state.documents.vue_texts() {
            Self::collect_symbols_from_document(&uri, &content, &query_lower, &mut symbols);
        }

        #[cfg(feature = "native")]
        disk::collect(state, &query_lower, &mut symbols);

        rank::sort(symbols, &query_lower)
    }

    /// Extract component name from URI.
    fn extract_component_name(uri: &Url) -> Option<String> {
        let path = uri.path();
        let file_name = path.rsplit('/').next()?;

        // Remove .vue extension
        let name = file_name.strip_suffix(".vue")?;

        // Convert to PascalCase
        Some(Self::to_pascal_case(name))
    }

    /// Convert string to PascalCase.
    fn to_pascal_case(s: &str) -> String {
        let mut result = String::with_capacity(s.len());
        let mut capitalize_next = true;

        for c in s.chars() {
            if c == '-' || c == '_' || c == '.' {
                capitalize_next = true;
            } else if capitalize_next {
                result.push(c.to_ascii_uppercase());
                capitalize_next = false;
            } else {
                result.push(c);
            }
        }

        result
    }

    /// Collect symbols from script content.
    fn collect_script_symbols(
        uri: &Url,
        script: &str,
        base_line: u32,
        query: &str,
        container: Option<&str>,
        symbols: &mut Vec<SymbolInformation>,
    ) {
        let lines: Vec<&str> = script.lines().collect();

        for (line_idx, line) in lines.iter().enumerate() {
            let line_num = base_line + line_idx as u32;
            let trimmed = line.trim_start();

            // const name = ...
            if let Some(rest) = trimmed.strip_prefix("const ") {
                if let Some((name, kind)) = Self::parse_declaration(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        kind,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // let name = ...
            else if let Some(rest) = trimmed.strip_prefix("let ") {
                if let Some((name, kind)) = Self::parse_declaration(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        kind,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // function name(...) { ... }
            else if let Some(rest) = trimmed.strip_prefix("function ") {
                if let Some(name) = Self::extract_identifier(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        SymbolKind::FUNCTION,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // async function name(...) { ... }
            else if let Some(rest) = trimmed.strip_prefix("async function ") {
                if let Some(name) = Self::extract_identifier(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        SymbolKind::FUNCTION,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // class Name { ... }
            else if let Some(rest) = trimmed.strip_prefix("class ") {
                if let Some(name) = Self::extract_identifier(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        SymbolKind::CLASS,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // interface Name { ... }
            else if let Some(rest) = trimmed.strip_prefix("interface ") {
                if let Some(name) = Self::extract_identifier(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        SymbolKind::INTERFACE,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // type Name = ...
            else if let Some(rest) = trimmed.strip_prefix("type ") {
                if let Some(name) = Self::extract_identifier(rest)
                    && name.to_lowercase().contains(query)
                {
                    symbols.push(Self::create_symbol(
                        name,
                        SymbolKind::TYPE_PARAMETER,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
            // enum Name { ... }
            else if let Some(rest) = trimmed.strip_prefix("enum ")
                && let Some(name) = Self::extract_identifier(rest)
                && name.to_lowercase().contains(query)
            {
                symbols.push(Self::create_symbol(
                    name,
                    SymbolKind::ENUM,
                    uri.clone(),
                    line_num - 1,
                    container,
                ));
            }
        }
    }

    /// Collect symbols from style content.
    fn collect_style_symbols(
        uri: &Url,
        style: &str,
        base_line: u32,
        query: &str,
        container: Option<&str>,
        symbols: &mut Vec<SymbolInformation>,
    ) {
        let lines: Vec<&str> = style.lines().collect();

        for (line_idx, line) in lines.iter().enumerate() {
            let line_num = base_line + line_idx as u32;
            let trimmed = line.trim();

            // CSS class selectors
            for class in Self::extract_css_classes(trimmed) {
                if class.to_lowercase().contains(query) {
                    symbols.push(Self::create_symbol(
                        format!(".{}", class),
                        SymbolKind::STRING,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }

            // CSS ID selectors
            for id in Self::extract_css_ids(trimmed) {
                if id.to_lowercase().contains(query) {
                    symbols.push(Self::create_symbol(
                        format!("#{}", id),
                        SymbolKind::STRING,
                        uri.clone(),
                        line_num - 1,
                        container,
                    ));
                }
            }
        }
    }

    /// Parse a declaration and return name and kind.
    fn parse_declaration(s: &str) -> Option<(String, SymbolKind)> {
        let name = Self::extract_identifier(s)?;

        // Determine kind based on initialization
        let kind = if s.contains("ref(") || s.contains("computed(") || s.contains("reactive(") {
            SymbolKind::VARIABLE
        } else if s.contains("=>") || s.contains("function") {
            SymbolKind::FUNCTION
        } else {
            SymbolKind::CONSTANT
        };

        Some((name, kind))
    }

    /// Extract identifier from string.
    fn extract_identifier(s: &str) -> Option<String> {
        let s = s.trim_start();
        // Destructuring patterns (`{`, `[`) are not identifier starts either.
        if !Self::is_ident_start(char::from(*s.as_bytes().first()?)) {
            return None;
        }

        let end = s
            .bytes()
            .take_while(|byte| Self::is_ident_char(char::from(*byte)))
            .count();
        Some(s.get(..end)?.to_string())
    }

    /// Extract CSS class names from a selector line.
    fn extract_css_classes(line: &str) -> Vec<String> {
        Self::extract_css_names(line, '.')
    }

    /// Extract CSS ID names from a selector line.
    fn extract_css_ids(line: &str) -> Vec<String> {
        Self::extract_css_names(line, '#')
    }

    /// Names following each `marker` (`.class`, `#id`) in a selector line.
    fn extract_css_names(line: &str, marker: char) -> Vec<String> {
        let mut names = Vec::new();
        let mut rest = line;

        while let Some((_, after)) = rest.split_once(marker) {
            let end = after
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
                .unwrap_or(after.len());
            let Some((name, tail)) = after.split_at_checked(end) else {
                break;
            };
            if !name.is_empty() {
                names.push(name.to_string());
            }
            rest = tail;
        }

        names
    }

    /// Create a symbol information entry.
    #[expect(
        deprecated,
        reason = "SymbolInformation.deprecated is deprecated in favor of tags"
    )]
    fn create_symbol(
        name: String,
        kind: SymbolKind,
        uri: Url,
        line: u32,
        container: Option<&str>,
    ) -> SymbolInformation {
        SymbolInformation {
            name,
            kind,
            tags: None,
            deprecated: None,
            location: Location {
                uri,
                range: Range {
                    start: Position { line, character: 0 },
                    end: Position { line, character: 0 },
                },
            },
            container_name: container.map(|s| s.to_string()),
        }
    }

    fn is_ident_start(c: char) -> bool {
        c.is_ascii_alphabetic() || c == '_' || c == '$'
    }

    fn is_ident_char(c: char) -> bool {
        c.is_ascii_alphanumeric() || c == '_' || c == '$'
    }
}
