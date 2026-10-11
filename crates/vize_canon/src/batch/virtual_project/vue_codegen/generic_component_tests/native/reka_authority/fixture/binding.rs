//! Pinned physical/native/export receipt binding; local mutations grant no native credit.
use serde_json::{Value, json};

pub(super) fn provider(prepared: &Value, source: &Value, expected: Option<&Value>) -> Value {
    let hash_matches = expected.is_some_and(|file| {
        file["sha256"].as_str().is_some()
            && file["physical"] == source["physical"]
            && file["sha256"] == source["completeNativeText"]["sha256"]
            && file["sha256"] == source["completePhysicalBytes"]["sha256"]
            && file["size"] == source["completeNativeText"]["byteLength"]
            && file["size"] == source["completePhysicalBytes"]["byteLength"]
    });
    let name = source["nativeSourceName"].as_str().unwrap();
    let is_vue = name.ends_with("/vue/dist/vue.d.mts") || name.ends_with("/vue/dist/vue.d.ts");
    let export = &source["providerExport"];
    let manifest = if is_vue {
        prepared["files"].as_array().unwrap().iter().find(|file| {
            file["role"] == "installed-vue-declaration-manifest"
                && file["physical"] == export["physicalPackageManifest"]
        })
    } else {
        None
    };
    let export_matches = if is_vue {
        let (condition, target) = if name.ends_with("/vue/dist/vue.d.mts") {
            ("import", "./dist/vue.d.mts")
        } else {
            ("require", "./dist/vue.d.ts")
        };
        let pinned = prepared["providers"]["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|provider| provider["name"] == "vue");
        manifest.is_some_and(|file| {
            file["sha256"].as_str().is_some()
                && file["sha256"] == export["wholePackageManifest"]["sha256"]
                && file["size"] == export["wholePackageManifest"]["byteLength"]
        }) && pinned.is_some_and(|provider| {
            provider["expected"].as_str().is_some()
                && provider["expected"] == export["packageVersion"]
        }) && export["packageName"] == "vue"
            && export["qualified"] == true
            && export["nativeExportCondition"] == condition
            && export["wholeSelectedTypesTarget"] == target
    } else {
        true
    };
    json!({"nativeSource":source,"wholePreparedIdentity":expected,
        "wholePreparedExportManifestIdentity":manifest,
        "qualified":hash_matches && export_matches && source["nativeMatchesPhysical"] == true})
}

#[cfg(test)]
mod tests {
    use super::provider;
    use serde_json::{Value, json};

    // Independently authored complete receipt metadata. These mutation laws do
    // not represent a native response; actual owner/source reads remain mandatory.
    fn fixture(extension: &str, condition: &str) -> (Value, Value) {
        let physical = format!("/workspace/node_modules/vue/dist/vue.{extension}");
        let prepared = json!({"files":[
            {"role":"installed-vue-declaration-candidate","physical":physical,
                "sha256":"c0191592be8eb7906f99ac4b8798d80a585b94001ea1a5f50d6ce5b0d13a5c62","size":299},
            {"role":"installed-vue-declaration-manifest","physical":"/workspace/node_modules/vue/package.json",
                "sha256":"73e12ff3bd2e2591fd5c22b3e16f19b904f78ef441cdf024ca6a685d991913cb","size":2810}],
            "providers":{"providers":[{"name":"vue","expected":"3.5.17"}]}});
        let source = json!({"nativeSourceName":physical,"physical":physical,"nativeMatchesPhysical":true,
            "completeNativeText":{"sha256":"c0191592be8eb7906f99ac4b8798d80a585b94001ea1a5f50d6ce5b0d13a5c62","byteLength":299},
            "completePhysicalBytes":{"sha256":"c0191592be8eb7906f99ac4b8798d80a585b94001ea1a5f50d6ce5b0d13a5c62","byteLength":299},
            "providerExport":{"qualified":true,"packageName":"vue","packageVersion":"3.5.17",
                "physicalPackageManifest":"/workspace/node_modules/vue/package.json",
                "wholePackageManifest":{"sha256":"73e12ff3bd2e2591fd5c22b3e16f19b904f78ef441cdf024ca6a685d991913cb","byteLength":2810},
                "nativeExportCondition":condition,"wholeSelectedTypesTarget":format!("./dist/vue.{extension}")}});
        (prepared, source)
    }

    #[test]
    fn exact_pinned_esm_and_cjs_receipts_require_full_source_and_export_hashes() {
        for (extension, condition) in [("d.mts", "import"), ("d.ts", "require")] {
            let (prepared, source) = fixture(extension, condition);
            let row = provider(&prepared, &source, Some(&prepared["files"][0]));
            assert_eq!(
                row,
                json!({"nativeSource":source,"wholePreparedIdentity":prepared["files"][0],
                "wholePreparedExportManifestIdentity":prepared["files"][1],"qualified":true})
            );
            let empty = json!({"loadedProviderSources":[]});
            assert_eq!(
                super::super::bind_native(&prepared, &empty),
                json!({"bindings":[],"qualified":false,
                "scope":"native Vue and runtime-core source identities/text must bind to genuine pinned fixture-owned prepared declarations, without ambient fallback"})
            );
        }
    }

    #[test]
    fn complete_esm_cjs_and_duplicate_core_metadata_cannot_replace_a_required_role() {
        let (mut prepared, esm) = fixture("d.mts", "import");
        let (cjs_prepared, cjs) = fixture("d.ts", "require");
        let core_identity = json!({"role":"installed-vue-declaration-candidate",
            "physical":"/workspace/node_modules/@vue/runtime-core/dist/runtime-core.d.ts",
            "sha256":"9aab7aec34d809b2868dd0f0743e47ff35c0795ec5072d825c4ba934206cc7d3","size":93059});
        let core = json!({
            "nativeSourceName":"/workspace/node_modules/@vue/runtime-core/dist/runtime-core.d.ts",
            "physical":"/workspace/node_modules/@vue/runtime-core/dist/runtime-core.d.ts",
            "nativeMatchesPhysical":true,
            "completeNativeText":{"sha256":"9aab7aec34d809b2868dd0f0743e47ff35c0795ec5072d825c4ba934206cc7d3","byteLength":93059},
            "completePhysicalBytes":{"sha256":"9aab7aec34d809b2868dd0f0743e47ff35c0795ec5072d825c4ba934206cc7d3","byteLength":93059}});
        prepared["files"]
            .as_array_mut()
            .unwrap()
            .extend([cjs_prepared["files"][0].clone(), core_identity.clone()]);
        let esm_binding = json!({"nativeSource":esm,"wholePreparedIdentity":prepared["files"][0],
            "wholePreparedExportManifestIdentity":prepared["files"][1],"qualified":true});
        let cjs_binding = json!({"nativeSource":cjs,"wholePreparedIdentity":cjs_prepared["files"][0],
            "wholePreparedExportManifestIdentity":prepared["files"][1],"qualified":true});
        let core_binding = json!({"nativeSource":core,"wholePreparedIdentity":core_identity,
            "wholePreparedExportManifestIdentity":null,"qualified":true});
        for (sources, bindings, qualified) in [
            (json!([esm, cjs]), json!([esm_binding, cjs_binding]), false),
            (
                json!([core, core]),
                json!([core_binding, core_binding]),
                false,
            ),
            (json!([esm, core]), json!([esm_binding, core_binding]), true),
        ] {
            let row =
                super::super::bind_native(&prepared, &json!({"loadedProviderSources":sources}));
            assert_eq!(
                row,
                json!({"bindings":bindings,"qualified":qualified,
                "scope":"native Vue and runtime-core source identities/text must bind to genuine pinned fixture-owned prepared declarations, without ambient fallback"})
            );
        }
    }

    #[test]
    fn foreign_missing_changed_and_false_physical_receipts_preserve_whole_refusals() {
        let (prepared, source) = fixture("d.mts", "import");
        let foreign = {
            let mut row = source.clone();
            row["physical"] = json!("/foreign/vue/dist/vue.d.mts");
            row
        };
        let missing = {
            let mut row = prepared.clone();
            row["files"].as_array_mut().unwrap().pop();
            row
        };
        let changed_text = {
            let mut row = source.clone();
            row["completeNativeText"]["sha256"] = json!("changed-full-text-hash");
            row
        };
        let changed_export = {
            let mut row = source.clone();
            row["providerExport"]["wholeSelectedTypesTarget"] = json!("./dist/foreign.d.mts");
            row
        };
        let changed_manifest = {
            let mut row = source.clone();
            row["providerExport"]["wholePackageManifest"]["sha256"] =
                json!("changed-full-manifest-hash");
            row
        };
        let false_physical = {
            let mut row = source.clone();
            row["nativeMatchesPhysical"] = json!(false);
            row
        };
        for (prepared, changed) in [
            (&prepared, &foreign),
            (&missing, &source),
            (&prepared, &changed_text),
            (&prepared, &changed_export),
            (&prepared, &changed_manifest),
            (&prepared, &false_physical),
        ] {
            let row = provider(prepared, changed, Some(&prepared["files"][0]));
            assert_eq!(row["qualified"], false);
            assert_eq!(row["nativeSource"], *changed);
        }
        let row = provider(&prepared, &source, None);
        assert_eq!(row["qualified"], false);
        assert_eq!(row["nativeSource"], source);
        assert_eq!(row["wholePreparedIdentity"], Value::Null);
    }
}
