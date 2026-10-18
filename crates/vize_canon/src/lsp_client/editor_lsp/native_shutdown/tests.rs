use super::{
    DARWIN_ARM64, LINUX_X64, eof_capability, image_digest, known_binary, known_contract,
    known_initialize,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Cursor, Read},
};

#[test]
fn streamed_image_digest_matches_whole_bytes_across_block_and_buffer_boundaries() {
    for length in [0, 1, 63, 64, 65, 65_535, 65_536, 65_537, 3 * 65_536 + 17] {
        let bytes: Vec<u8> = (0..length).map(|index| (index % 251) as u8).collect();
        let expected: [u8; 32] = Sha256::digest(&bytes).into();
        assert_eq!(image_digest(bytes.as_slice()).unwrap(), expected);
    }
}

#[test]
fn streamed_image_digest_retries_interrupted_short_reads_until_eof() {
    struct ShortReads {
        image: Cursor<Vec<u8>>,
        calls: usize,
    }
    impl Read for ShortReads {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            assert_eq!(buffer.len(), 64 * 1024);
            self.calls += 1;
            if self.calls % 3 == 1 {
                return Err(io::ErrorKind::Interrupted.into());
            }
            let length = buffer.len().min(97);
            self.image.read(buffer.get_mut(..length).unwrap())
        }
    }
    let bytes: Vec<u8> = (0..131_073).map(|index| (index % 251) as u8).collect();
    let expected: [u8; 32] = Sha256::digest(&bytes).into();
    let mut reader = ShortReads {
        image: Cursor::new(bytes),
        calls: 0,
    };
    assert_eq!(image_digest(&mut reader).unwrap(), expected);
    assert_eq!(reader.image.position(), 131_073);
    assert!(reader.calls > 1_000);
}

#[test]
fn streamed_image_digest_rejects_read_errors_after_a_complete_buffer() {
    struct FailedRead;
    impl Read for FailedRead {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("late image read failure"))
        }
    }
    let image = Cursor::new(vec![42; 65_536]).chain(FailedRead);
    let error = image_digest(image).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::Other);
    assert_eq!(error.to_string(), "late image read failure");
}

#[test]
fn streamed_image_digest_rejects_invalid_read_lengths() {
    struct InvalidRead;
    impl Read for InvalidRead {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            Ok(buffer.len() + 1)
        }
    }
    assert_eq!(
        image_digest(InvalidRead).unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
}

#[test]
fn streamed_image_digest_authenticates_bytes_in_the_final_partial_buffer() {
    let mut bytes = vec![42; 2 * 65_536 + 11];
    let original = image_digest(bytes.as_slice()).unwrap();
    *bytes.get_mut(2 * 65_536 + 5).unwrap() ^= 1;
    assert_ne!(image_digest(bytes.as_slice()).unwrap(), original);
}

#[test]
fn eof_requires_both_full_physical_image_and_complete_initialize_contract() {
    let initialized = known_contract();
    assert!(known_initialize(&initialized));
    assert!(known_binary(LINUX_X64));
    assert!(known_binary(DARWIN_ARM64));
    for value in [
        json!(null),
        json!({}),
        json!({"serverInfo":{"name":"typescript-go"}}),
        json!({"serverInfo":{"name":"other","version":"7.0.2"}}),
        json!({"serverInfo":{"name":"typescript-go","version":"7.0.3"}}),
        json!({"serverInfo":{"name":"typescript-go","version":7.02}}),
    ] {
        assert!(!known_initialize(&value));
    }
    let mut changed = initialized.clone();
    changed["capabilities"]["positionEncoding"] = json!("utf-8");
    assert!(!known_initialize(&changed));
    let mut changed = initialized.clone();
    changed["capabilities"]
        .as_object_mut()
        .unwrap()
        .remove("diagnosticProvider");
    assert!(!known_initialize(&changed));
    let temp = tempfile::tempdir().unwrap();
    let fake = temp.path().join("native");
    let observer = corsa_lsp::process::ProcessObserver::default();
    fs::write(&fake, b"Version 7.0.2\n").unwrap();
    assert!(!eof_capability(&fake, &initialized, &observer));
    fs::write(&fake, b"Version 7.0.2\n\0\xff").unwrap();
    assert!(!eof_capability(&fake, &initialized, &observer));
    assert!(!eof_capability(
        &temp.path().join("absent"),
        &initialized,
        &observer
    ));
    for digest in [
        "",
        "4f2de678",
        &"f".repeat(64),
        vize_l0::cstr!("{LINUX_X64}00").as_str(),
    ] {
        assert!(!known_binary(digest));
    }
}

#[cfg(unix)]
#[test]
fn null_ack_precedes_eof_foreign_exit_is_preserved_and_failed_ack_still_closes() {
    use super::close;
    use corsa::runtime::block_on;
    use corsa_lsp::{CorsaError, LspClient, LspSpawnConfig};
    use serde_json::Value;
    use std::os::unix::fs::PermissionsExt;

    for (shutdown_to_eof, mode) in [
        (true, "ok"),
        (false, "ok"),
        (true, "error"),
        (true, "non-null"),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let script = temp.path().join("peer.ts");
        let log = temp.path().join("whole-packets.jsonl");
        let source = include_str!("peer.ts.txt")
            .replace("LOG_PATH", &serde_json::to_string(&log).unwrap())
            .replace("REPLY_MODE", &serde_json::to_string(mode).unwrap());
        fs::write(&script, source).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let client = block_on(LspClient::spawn(LspSpawnConfig::new(&script))).unwrap();
        let result = block_on(close(&client, shutdown_to_eof));
        let response = match mode {
            "error" => {
                let expected = json!({"code":-32603,"message":"controlled shutdown refusal","data":{"phase":"shutdown"}});
                let Err(CorsaError::Rpc(error)) = result else {
                    panic!("{result:?}")
                };
                assert_eq!(serde_json::to_value(error).unwrap(), expected);
                json!({"jsonrpc":"2.0","id":1,"error":expected})
            }
            "non-null" => {
                let Err(CorsaError::Json(error)) = result else {
                    panic!("{result:?}")
                };
                assert_eq!(error.classify(), serde_json::error::Category::Data);
                json!({"jsonrpc":"2.0","id":1,"result":{"not":"null"}})
            }
            "ok" => {
                result.unwrap();
                json!({"jsonrpc":"2.0","id":1,"result":null})
            }
            _ => unreachable!(),
        };
        let actual: Vec<Value> = fs::read_to_string(&log)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let mut expected = vec![
            json!({"direction":"request","wholePacket":{"jsonrpc":"2.0","id":1,"method":"shutdown"}}),
            json!({"direction":"response","wholePacket":response}),
        ];
        if !shutdown_to_eof {
            expected.push(
                json!({"direction":"request","wholePacket":{"jsonrpc":"2.0","method":"exit"}}),
            );
        }
        expected.push(json!({"event":"stdin-eof"}));
        assert_eq!(
            actual, expected,
            "complete protocol transcript: {mode}, native={shutdown_to_eof}"
        );
    }
}

#[test]
fn whole_initialize_contracts_and_images_are_matched_as_pairs() {
    use super::{CONTENT_MAPPER_D6C_LINUX_X64, EofContract, content_mapper_contract, eof_contract};
    let old = known_contract();
    let current = content_mapper_contract().unwrap();
    assert_eq!(eof_contract(&old), Some(EofContract::Native702));
    assert_eq!(eof_contract(&current), Some(EofContract::ContentMapperD6c));
    let mut expected_current = old.clone();
    expected_current["serverInfo"] = json!({"name":"typescript","version":"7.1.0-dev"});
    assert_eq!(current, expected_current);
    for (initialized, expected_matches) in [
        (&old, [true, true, false]),
        (&current, [false, false, true]),
    ] {
        let contract = eof_contract(initialized).unwrap();
        for (digest, expected) in [LINUX_X64, DARWIN_ARM64, CONTENT_MAPPER_D6C_LINUX_X64]
            .into_iter()
            .zip(expected_matches)
        {
            assert_eq!(
                contract.accepts_image(digest),
                expected,
                "complete pair {digest}: {initialized}"
            );
        }
        for digest in [
            "",
            "77dd575e",
            &"f".repeat(64),
            vize_l0::cstr!("{CONTENT_MAPPER_D6C_LINUX_X64}00").as_str(),
        ] {
            assert!(!contract.accepts_image(digest));
        }
    }
    // The old image helper remains scoped to its original two identities.
    assert!(!known_binary(CONTENT_MAPPER_D6C_LINUX_X64));
}

#[test]
fn every_whole_contract_field_and_unexpected_member_is_authenticated() {
    use super::{content_mapper_contract, eof_contract};
    use serde_json::Value;

    fn paths(value: &Value, path: &str, result: &mut Vec<vize_l0::String>) {
        result.push(vize_l0::cstr!("{path}"));
        match value {
            Value::Object(object) => {
                for (key, value) in object {
                    let escaped = key.replace('~', "~0").replace('/', "~1");
                    paths(value, vize_l0::cstr!("{path}/{escaped}").as_str(), result);
                }
            }
            Value::Array(array) => {
                for (index, value) in array.iter().enumerate() {
                    paths(value, vize_l0::cstr!("{path}/{index}").as_str(), result);
                }
            }
            _ => {}
        }
    }

    for initialized in [known_contract(), content_mapper_contract().unwrap()] {
        let mut members = Vec::new();
        paths(&initialized, "", &mut members);
        assert!(members.len() > 80, "authenticate the complete tree");
        for path in members {
            let original = initialized.pointer(path.as_str()).unwrap();
            let replacement = if original.is_null() {
                json!(false)
            } else {
                Value::Null
            };
            let mut changed = initialized.clone();
            *changed.pointer_mut(path.as_str()).unwrap() = replacement;
            assert!(
                eof_contract(&changed).is_none(),
                "changed whole value at {path}"
            );
            if let Some(object) = original.as_object() {
                for key in object.keys() {
                    let mut changed = initialized.clone();
                    changed
                        .pointer_mut(path.as_str())
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .remove(key);
                    assert!(eof_contract(&changed).is_none(), "missing {path}/{key}");
                }
                let mut changed = initialized.clone();
                changed
                    .pointer_mut(path.as_str())
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .insert("unexpectedCapability".into(), json!(true));
                assert!(
                    eof_contract(&changed).is_none(),
                    "unexpected whole member at {path}"
                );
            }
            if original.is_array() {
                let mut changed = initialized.clone();
                changed
                    .pointer_mut(path.as_str())
                    .unwrap()
                    .as_array_mut()
                    .unwrap()
                    .push(json!(null));
                assert!(
                    eof_contract(&changed).is_none(),
                    "unexpected array member at {path}"
                );
            }
        }
    }
}

#[test]
fn current_initialize_cannot_authenticate_foreign_or_absent_physical_images() {
    use super::content_mapper_contract;
    let initialized = content_mapper_contract().unwrap();
    let project = tempfile::tempdir().unwrap();
    let fake = project.path().join("current-provider");
    let observer = corsa_lsp::process::ProcessObserver::default();
    for bytes in [
        b"Version 7.1.0-dev\n".as_slice(),
        b"Version 7.1.0-dev\n\0\xff".as_slice(),
    ] {
        fs::write(&fake, bytes).unwrap();
        assert!(!eof_capability(&fake, &initialized, &observer));
    }
    assert!(!eof_capability(
        &project.path().join("absent"),
        &initialized,
        &observer
    ));
}
