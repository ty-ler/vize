//! Install lint settings and compiler policy from the same loaded document.
use super::super::ServerState;
use vize_l0::{String, config::LinterConfig};
use vize_relief::options::CustomElementMatcher;

impl ServerState {
    pub(super) fn apply_linter_config(
        &self,
        config: LinterConfig,
        custom_elements: Vec<String>,
        source: &str,
    ) {
        let custom_elements = CustomElementMatcher::from_patterns(custom_elements);
        let mut snapshot = self.linter_config.write();
        snapshot.0 = config;
        snapshot.2 = custom_elements;
        tracing::info!("Loaded linter config from {}", source);
    }
}
