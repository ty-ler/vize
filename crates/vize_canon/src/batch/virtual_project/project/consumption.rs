use std::path::{Path, PathBuf};

use super::super::VirtualProject;
use crate::package_route::stamp::{Consumed, InputStamp};
use serde_json::{Map, Value};

pub(in super::super) fn empty(observe: bool) -> Consumed<()> {
    Consumed {
        value: (),
        stamps: Vec::new(),
        qualified: observe,
    }
}

pub(in super::super) fn take<T>(facts: &mut Consumed<()>, consumed: Consumed<T>) -> T {
    facts.qualified &= consumed.qualified;
    facts.stamps.extend(consumed.stamps);
    consumed.value
}

pub(in super::super) fn finish<T>(facts: Consumed<()>, value: T) -> Consumed<T> {
    Consumed {
        value,
        stamps: facts.stamps,
        qualified: facts.qualified,
    }
}

impl VirtualProject {
    pub(crate) fn consume_configuration<T>(facts: &mut Consumed<()>, consumed: Consumed<T>) -> T {
        take(facts, consumed)
    }

    pub(crate) fn canonical_configuration_path(path: &Path, observe: bool) -> Consumed<PathBuf> {
        let value = vize_carton::path::canonicalize_non_verbatim(path);
        let mut facts = empty(observe && path.is_absolute() && value.is_absolute());
        if observe {
            facts.stamps.push(InputStamp::observed_canonical_path(
                path.to_path_buf(),
                value.clone(),
            ));
        }
        finish(facts, value)
    }

    #[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
    pub(in super::super) fn configuration_options(
        &self,
        path: Option<&Path>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> Option<Map<std::string::String, Value>> {
        if !observe {
            return self.load_compiler_options(path).ok();
        }
        match self.load_compiler_options_flattened_observed(path) {
            Ok(consumed) => Some(take(facts, consumed).options),
            Err(_) => {
                facts.qualified = false;
                None
            }
        }
    }
}
