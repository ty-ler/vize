//! Bind an actually loaded Vue declaration to its complete physical package export.
//! This helper is reachable only from the existing cfg(test) provider observer.
use serde_json::{Value, json};
use std::{fs, path::Path};
use vize_l0::cstr;

pub(super) fn receipt(name: &str, physical: &Path, retain: &impl Fn(&[u8]) -> Value) -> Value {
    let mut observed = json!({"qualified":false,"nativeSourceName":name,"physicalSource":physical,
        "scope":"actual loaded native Vue declaration and complete physical package.json; no absent declaration credit"});
    let Some(root) = physical.parent().and_then(Path::parent) else {
        return observed;
    };
    let manifest = root.join("package.json");
    observed["physicalPackageManifest"] = json!(manifest);
    let bytes = match fs::read(&manifest) {
        Ok(bytes) => bytes,
        Err(error) => {
            observed["wholeReadError"] = json!(cstr!("{error}"));
            return observed;
        }
    };
    observed["wholePackageManifest"] = retain(&bytes);
    let metadata: Value = match serde_json::from_slice(&bytes) {
        Ok(metadata) => metadata,
        Err(error) => {
            observed["wholeParseError"] = json!(cstr!("{error}"));
            return observed;
        }
    };
    let (condition, expected) = if Path::new(name).ends_with("vue/dist/vue.d.mts") {
        ("import", "./dist/vue.d.mts")
    } else if Path::new(name).ends_with("vue/dist/vue.d.ts") {
        ("require", "./dist/vue.d.ts")
    } else {
        return observed;
    };
    let target = &metadata["exports"]["."][condition]["types"];
    observed["packageName"] = metadata["name"].clone();
    observed["packageVersion"] = metadata["version"].clone();
    observed["nativeExportCondition"] = json!(condition);
    observed["wholeSelectedTypesTarget"] = target.clone();
    observed["expectedSelectedTypesTarget"] = json!(expected);
    let same_source = fs::canonicalize(name).ok().as_deref() == Some(physical);
    let same_target = fs::canonicalize(root.join(&expected[2..])).ok().as_deref() == Some(physical);
    observed["sameNativePhysicalSource"] = json!(same_source);
    observed["sameExportPhysicalSource"] = json!(same_target);
    observed["qualified"] = json!(
        metadata["name"] == "vue"
            && target == expected
            && physical.is_file()
            && same_source
            && same_target
    );
    observed
}

#[cfg(test)]
mod tests {
    use super::receipt;
    use serde_json::{Value, json};
    use std::fs;

    const PINNED: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/_fixtures/differential/typechecker/native-provider-exports/vue-3.5.17-package.json.txt"
    ));

    #[test]
    fn genuine_pinned_esm_and_cjs_exports_bind_complete_physical_manifest() {
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("node_modules/vue");
        fs::create_dir_all(package.join("dist")).unwrap();
        fs::write(package.join("package.json"), PINNED).unwrap();
        for (file, condition, target) in [
            ("vue.d.mts", "import", "./dist/vue.d.mts"),
            ("vue.d.ts", "require", "./dist/vue.d.ts"),
        ] {
            let source = package.join("dist").join(file);
            fs::write(&source, b"export const version: string;\n").unwrap();
            let source = source.canonicalize().unwrap();
            let row = receipt(source.to_str().unwrap(), &source, &|bytes| json!(bytes));
            assert_eq!(
                row,
                json!({"qualified":true,"nativeSourceName":source,"physicalSource":source,
                "scope":"actual loaded native Vue declaration and complete physical package.json; no absent declaration credit",
                "physicalPackageManifest":package.canonicalize().unwrap().join("package.json"),
                "wholePackageManifest":PINNED,"packageName":"vue","packageVersion":"3.5.17",
                "nativeExportCondition":condition,"wholeSelectedTypesTarget":target,
                "expectedSelectedTypesTarget":target,"sameNativePhysicalSource":true,"sameExportPhysicalSource":true})
            );
        }
    }

    #[test]
    fn missing_foreign_and_changed_exports_never_supply_vue_provider_credit() {
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("node_modules/vue");
        fs::create_dir_all(package.join("dist")).unwrap();
        let source = package.join("dist/vue.d.mts");
        fs::write(&source, b"export const version: string;\n").unwrap();
        let source = source.canonicalize().unwrap();
        let pinned: Value = serde_json::from_slice(PINNED).unwrap();
        for changed in [
            {
                let mut value = pinned.clone();
                value["exports"]["."]["import"]
                    .as_object_mut()
                    .unwrap()
                    .remove("types");
                value
            },
            {
                let mut value = pinned.clone();
                value["name"] = json!("foreign-vue");
                value
            },
            {
                let mut value = pinned.clone();
                value["exports"]["."]["import"]["types"] = json!("./dist/foreign.d.mts");
                value
            },
        ] {
            let bytes = serde_json::to_vec(&changed).unwrap();
            fs::write(package.join("package.json"), &bytes).unwrap();
            let row = receipt(source.to_str().unwrap(), &source, &|bytes| json!(bytes));
            assert_eq!(row["qualified"], false);
            assert_eq!(row["wholePackageManifest"], json!(bytes));
        }
        fs::write(package.join("package.json"), PINNED).unwrap();
        let foreign_package = root.path().join("foreign/node_modules/vue");
        fs::create_dir_all(foreign_package.join("dist")).unwrap();
        fs::write(foreign_package.join("package.json"), PINNED).unwrap();
        let foreign = foreign_package.join("dist/vue.d.mts");
        fs::write(&foreign, b"export const version: string;\n").unwrap();
        let foreign = foreign.canonicalize().unwrap();
        let row = receipt(source.to_str().unwrap(), &foreign, &|bytes| json!(bytes));
        assert_eq!(row["qualified"], false);
        assert_eq!(row["sameNativePhysicalSource"], false);
        assert_eq!(row["wholePackageManifest"], json!(PINNED));
        fs::remove_file(&source).unwrap();
        let row = receipt(source.to_str().unwrap(), &source, &|bytes| json!(bytes));
        assert_eq!(row["qualified"], false);
        assert_eq!(row["wholePackageManifest"], json!(PINNED));
        fs::remove_file(package.join("package.json")).unwrap();
        let row = receipt(source.to_str().unwrap(), &source, &|bytes| json!(bytes));
        assert_eq!(row["qualified"], false);
    }
}
