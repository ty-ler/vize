//! Original collectors shared by streamed sources; the materialized oracle is test-only.

#[cfg(feature = "native")]
use tower_lsp::lsp_types::{SymbolInformation, Url};

#[cfg(feature = "native")]
use super::{WorkspaceSymbolsService, rank, script};

/// A synchronous collector needs no owned copy of the source or its blocks.
pub(super) fn borrowed_descriptor<'a>(
    filename: &str,
    source: &'a str,
) -> Option<vize_atelier_sfc::SfcDescriptor<'a>> {
    vize_atelier_sfc::parse_sfc(
        source,
        vize_atelier_sfc::SfcParseOptions {
            filename: vize_l0::String::from(filename),
            ..Default::default()
        },
    )
    .ok()
}

#[cfg(feature = "native")]
impl WorkspaceSymbolsService {
    #[cfg(all(test, feature = "native"))]
    pub(crate) fn search_sources(
        sources: &[(Url, std::string::String)],
        query: &str,
    ) -> Vec<SymbolInformation> {
        let query = query.to_lowercase();
        let mut symbols = Vec::new();
        for (uri, source) in sources {
            if uri.path().ends_with(".vue") {
                Self::collect_symbols_from_document(uri, source, &query, &mut symbols);
            } else {
                script::collect(uri, source, &query, &mut symbols);
            }
        }
        rank::sort(symbols, &query)
    }

    #[cfg(feature = "native")]
    pub(crate) fn collect_source(
        uri: &Url,
        source: &str,
        query_lower: &str,
        symbols: &mut Vec<SymbolInformation>,
    ) {
        if uri.path().ends_with(".vue") {
            Self::collect_symbols_from_document(uri, source, query_lower, symbols);
        } else {
            script::collect(uri, source, query_lower, symbols);
        }
    }

    #[cfg(feature = "native")]
    pub(crate) fn rank_sources(
        symbols: Vec<SymbolInformation>,
        query_lower: &str,
    ) -> Vec<SymbolInformation> {
        rank::sort(symbols, query_lower)
    }
}
