//! Original collectors shared by streamed sources; the materialized oracle is test-only.

#[cfg(feature = "native")]
use tower_lsp::lsp_types::{SymbolInformation, Url};

#[cfg(feature = "native")]
use super::{WorkspaceSymbolsService, rank, script};

pub(super) fn borrowed_descriptor<'a>(
    filename: &str,
    source: &'a str,
) -> Option<vize_atelier_sfc::SfcDescriptor<'a>> {
    let filename = vize_l0::String::from(filename);
    let (descriptor, errors) = vize_atelier_sfc::parse_sfc(
        source,
        vize_atelier_sfc::SfcParseOptions {
            filename,
            ..Default::default()
        },
    );
    errors.is_empty().then_some(descriptor)
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

    #[cfg(test)]
    pub(crate) fn collect_source(
        uri: &Url,
        source: &str,
        query_lower: &str,
        symbols: &mut Vec<SymbolInformation>,
    ) {
        let allocator = vize_l0::Allocator::default();
        Self::collect_source_in(uri, source, query_lower, symbols, &allocator);
    }

    pub(crate) fn collect_source_in(
        uri: &Url,
        source: &str,
        query_lower: &str,
        symbols: &mut Vec<SymbolInformation>,
        allocator: &vize_l0::Allocator,
    ) {
        if uri.path().ends_with(".vue") {
            Self::collect_symbols_from_document_in(uri, source, query_lower, symbols, allocator);
        } else {
            script::collect_in(uri, source, query_lower, symbols, allocator);
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
