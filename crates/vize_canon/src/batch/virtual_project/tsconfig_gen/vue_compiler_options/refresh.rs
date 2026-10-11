use super::{ResolveStyleClassNames, Value, VirtualProject, check_unknown_props_enabled};

impl VirtualProject {
    pub(in super::super::super) fn refresh_vue_compiler_options(&mut self) {
        self.refresh_vue_compiler_options_consumed(false);
    }

    pub(in super::super::super) fn refresh_vue_compiler_options_consumed(
        &mut self,
        observe: bool,
    ) -> crate::package_route::stamp::Consumed<()> {
        use super::super::super::project::consumption::{empty, finish, take};
        let mut facts = empty(observe);
        let path = take(&mut facts, self.resolved_tsconfig_path_consumed(observe));
        let options = if observe {
            match self.load_vue_compiler_options_observed(path.as_deref()) {
                Ok(consumed) => Some(take(&mut facts, consumed)),
                Err(_) => {
                    facts.qualified = false;
                    None
                }
            }
        } else {
            self.load_vue_compiler_options(path.as_deref()).ok()
        };
        self.typed_router.root = take(
            &mut facts,
            super::super::super::typed_router::configured_root_consumed(
                self,
                options.as_ref(),
                path.as_deref(),
                observe,
            ),
        );
        self.virtual_ts_check_options.check_unknown_props = if path.is_none() {
            true
        } else {
            options
                .as_ref()
                .map(check_unknown_props_enabled)
                .unwrap_or(true)
        };
        self.virtual_ts_check_options
            .check_unknown_fallthrough_props = options.as_ref().is_some_and(|options| {
            options.get("checkUnknownProps").and_then(Value::as_bool) == Some(true)
        });
        self.virtual_ts_check_options.strict_css_modules = options
            .as_ref()
            .and_then(|options| options.get("strictCssModules").and_then(Value::as_bool))
            .unwrap_or(false);
        self.virtual_ts_check_options.check_unknown_components = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("checkUnknownComponents")
                    .or_else(|| options.get("strictTemplates"))
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.check_unknown_events = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("checkUnknownEvents")
                    .or_else(|| options.get("strictTemplates"))
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.check_unknown_directives = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("checkUnknownDirectives")
                    .or_else(|| options.get("strictTemplates"))
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.strict_v_model = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("strictVModel")
                    .or_else(|| options.get("strictTemplates"))
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.vapor = options
            .as_ref()
            .and_then(|options| options.get("vapor").and_then(Value::as_bool))
            .unwrap_or(false);
        self.virtual_ts_check_options.infer_component_dollar_el = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("inferComponentDollarEl")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.infer_template_dollar_el = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("inferTemplateDollarEl")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        let flag = |name: &str| {
            options
                .as_ref()
                .and_then(|options| options.get(name).and_then(Value::as_bool))
                .unwrap_or(false)
        };
        self.virtual_ts_check_options.strict_component_attrs = flag("strictComponentAttrs");
        self.virtual_ts_check_options.infer_component_dollar_refs =
            flag("inferComponentDollarRefs");
        self.virtual_ts_check_options.infer_template_dollar_refs = flag("inferTemplateDollarRefs");
        self.virtual_ts_check_options.jsx_slots = options
            .as_ref()
            .and_then(|options| options.get("jsxSlots").and_then(Value::as_bool))
            .unwrap_or(false);
        self.virtual_ts_check_options.infer_template_dollar_slots = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("inferTemplateDollarSlots")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.infer_template_dollar_attrs = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("inferTemplateDollarAttrs")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.fallthrough_attributes = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("fallthroughAttributes")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options
            .check_required_fallthrough_attributes = options
            .as_ref()
            .and_then(|options| {
                options
                    .get("checkRequiredFallthroughAttributes")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);
        self.virtual_ts_check_options.resolve_style_class_names = match options
            .as_ref()
            .and_then(|options| options.get("resolveStyleClassNames"))
        {
            Some(Value::Bool(true)) => ResolveStyleClassNames::All,
            Some(Value::Bool(false)) => ResolveStyleClassNames::None,
            _ => ResolveStyleClassNames::Scoped,
        };
        self.virtual_ts_check_options.resolve_style_imports = options
            .as_ref()
            .and_then(|options| options.get("resolveStyleImports").and_then(Value::as_bool))
            .unwrap_or(false);
        finish(facts, ())
    }
}
