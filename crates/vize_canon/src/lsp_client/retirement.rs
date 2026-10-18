//! Typed handles are captured before session cleanup consumes their fields.
use super::CorsaProjectClient;
use corsa::{
    api::ApiClient,
    process::{ProcessOwnership, ProcessTerminalObserver},
    runtime::block_on,
};
use corsa_lsp::LspClient;
use serde_json::{Value, json};
use vize_l0::{String, cstr};

#[derive(Clone)]
pub(crate) enum CloseHandle {
    Api(ApiClient),
    Editor(LspClient),
}

impl CloseHandle {
    fn preclose_terminal(&self) -> Result<corsa::process::PreCloseTerminalProof, String> {
        let proof = match self {
            Self::Api(client) => client.observe_preclose_terminal(),
            Self::Editor(client) => client.observe_preclose_terminal(),
        }
        .map_err(|error| cstr!("Cannot prove preexisting native terminal: {error}"))?;
        proof.ok_or_else(|| cstr!("Native owner was alive at the preclose probe"))
    }

    pub(crate) fn observer(&self) -> Option<ProcessTerminalObserver> {
        match match self {
            Self::Api(client) => client.process_ownership(),
            Self::Editor(client) => client.process_ownership(),
        } {
            ProcessOwnership::Owned(observer) => Some(observer),
            ProcessOwnership::Attached => None,
        }
    }

    pub(crate) fn acknowledged(&self) -> bool {
        self.observer()
            .is_some_and(|observer| observer.snapshot().custody_complete())
    }

    pub(crate) fn retry(&self) -> Result<(), String> {
        let result = match self {
            Self::Api(client) => block_on(client.abort_startup()),
            Self::Editor(client) => client.abort_startup(),
        };
        result
            .map(|_| ())
            .map_err(|error| cstr!("Exact owned retirement cleanup retry: {error}"))
    }
}

#[derive(Default)]
pub(crate) struct CloseOwners {
    pub(crate) handles: Vec<CloseHandle>,
    pub(crate) attached_bindings: Vec<Value>,
    pub(crate) missing_binding: bool,
}

impl CloseOwners {
    /// Every independent process must be proved dead before cleanup starts.
    /// Attachments explain a transport only; they cannot prove a child died.
    pub(crate) fn preclose_proofs(
        &self,
        unpublished: &[ProcessTerminalObserver],
    ) -> Result<Vec<corsa::process::PreCloseTerminalProof>, String> {
        if self.missing_binding || self.handles.is_empty() {
            return Err(cstr!(
                "Native owner set lacks an exact independent process binding"
            ));
        }
        let mut proofs = Vec::with_capacity(self.handles.len());
        for handle in &self.handles {
            let observer = handle
                .observer()
                .ok_or_else(|| cstr!("Native child handle is only an attachment"))?;
            let proof = handle.preclose_terminal()?;
            if !proof.matches(&observer, proof.observation().spawn_sequence) {
                return Err(cstr!(
                    "Native preclose proof does not match its exact owner"
                ));
            }
            proofs.push(proof);
        }
        validate_preclose_inventory(&proofs, unpublished, &self.attached_bindings)?;
        Ok(proofs)
    }

    pub(crate) fn append(&mut self, other: Self) {
        for handle in other.handles {
            if let Some(observer) = handle.observer() {
                if !self
                    .handles
                    .iter()
                    .filter_map(CloseHandle::observer)
                    .any(|existing| existing.same_owner(&observer))
                {
                    self.handles.push(handle);
                }
            } else {
                self.missing_binding = true;
            }
        }
        self.attached_bindings.extend(other.attached_bindings);
        self.missing_binding |= other.missing_binding;
    }
}

fn validate_preclose_inventory(
    proofs: &[corsa::process::PreCloseTerminalProof],
    unpublished: &[ProcessTerminalObserver],
    bindings: &[Value],
) -> Result<(), String> {
    let matches = |proof: &corsa::process::PreCloseTerminalProof,
                   observer: &ProcessTerminalObserver| {
        proof.matches(observer, proof.observation().spawn_sequence)
    };
    if proofs.is_empty()
        || unpublished.len() != proofs.len()
        || unpublished.iter().any(|observer| {
            proofs
                .iter()
                .filter(|proof| matches(proof, observer))
                .count()
                != 1
        })
        || proofs.iter().any(|proof| {
            unpublished
                .iter()
                .filter(|observer| matches(proof, observer))
                .count()
                != 1
        })
    {
        return Err(cstr!(
            "Native preclose proof is not an exact owner bijection"
        ));
    }
    for binding in bindings {
        let pid = binding.get("ownerExpectedPid").and_then(Value::as_u64);
        let sequence = binding.get("ownerSpawnSequence").and_then(Value::as_u64);
        let attachment = binding.get("attachment");
        if binding.get("ownership").and_then(Value::as_str) != Some("attached")
            || !attachment.is_some_and(|attachment| {
                ["pipe", "sessionId"].iter().all(|field| {
                    attachment
                        .get(field)
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
                })
            })
            || proofs
                .iter()
                .filter(|proof| {
                    let observation = proof.observation();
                    pid == Some(u64::from(observation.expected_pid))
                        && sequence == Some(observation.spawn_sequence)
                })
                .count()
                != 1
        {
            return Err(cstr!(
                "Native preclose attachment lacks its exact proved owner"
            ));
        }
    }
    Ok(())
}

impl CorsaProjectClient {
    pub(crate) fn retirement_owners(&self) -> CloseOwners {
        let mut owners = CloseOwners::default();
        if let Some(session) = &self.session {
            match session.client().process_ownership() {
                ProcessOwnership::Owned(_) => owners
                    .handles
                    .push(CloseHandle::Api(session.client().clone())),
                ProcessOwnership::Attached => {
                    if self.project_session_attached_to_editor
                        && let Some(editor) = &self.editor_lsp
                    {
                        owners.append(editor.retirement_attachment("project-api"));
                    } else {
                        owners.missing_binding = true;
                    }
                }
            }
        }
        if let Some(editor) = &self.editor_lsp {
            owners.append(editor.retirement_owners("editor"));
        }
        if let Some(authored) = &self.original_diagnosing_session {
            owners.append(authored.retirement_owners());
        }
        owners
    }
}

pub(crate) fn ownership_error(owner: &ProcessOwnership, error: &str) {
    if let ProcessOwnership::Owned(observer) = owner {
        observer.record_error(error);
    }
}

pub(crate) fn observation_json(observed: &corsa::process::ProcessCloseObservation) -> Value {
    let terminal = observed.terminal.as_ref().map(|terminal| {
        #[cfg(unix)]
        let signal = { use std::os::unix::process::ExitStatusExt; terminal.status.signal() };
        #[cfg(not(unix))]
        let signal: Option<i32> = None;
        json!({"pid":terminal.pid,"status":cstr!("{:?}",terminal.status),"exitCode":terminal.status.code(),"signal":signal,"killRequested":terminal.kill_requested,"timedOut":terminal.timed_out,"reaped":terminal.reaped})
    });
    let stderr = match &observed.stderr_receipts {
        None => json!({"mode":"inherited-server-stderr"}),
        Some(receipts) => {
            json!({"mode":"observed-editor","receipts":receipts.iter().map(|receipt| json!({"pid":receipt.pid,"completed":receipt.completed,"bytes":receipt.stderr,"stderrComplete":receipt.stderr_complete,"stderrError":receipt.stderr_error,"processError":receipt.process_error,"status":receipt.exit_status.map(|status| cstr!("{status:?}")),"timedOut":receipt.timed_out,"killRequested":receipt.kill_requested,"reaped":receipt.reaped})).collect::<Vec<_>>()})
        }
    };
    json!({"spawnSequence":observed.spawn_sequence,"expectedPid":observed.expected_pid,"role":observed.context,"terminal":terminal,"raw_errors":observed.raw_errors,"close_error":observed.close_error,"stderrCustody":stderr})
}

#[cfg(all(test, unix))]
mod preclose_tests {
    use super::*;
    use corsa::process::{CorsaCommand, PreCloseTerminalProof, ProcessLifetimeObserver};
    use corsa_lsp::process::ProcessObserver;
    use std::time::{Duration, Instant};

    fn real_terminal_proof() -> (PreCloseTerminalProof, ProcessTerminalObserver) {
        let stderr = ProcessObserver::default();
        let command = CorsaCommand::new("sh")
            .with_process_observer(stderr.clone())
            .with_lifetime_observer(ProcessLifetimeObserver::default(), "bijection test");
        let owned = command
            .spawn_guarded(["-c", "printf 'whole native stderr\\n' >&2; kill -KILL $$"])
            .unwrap();
        let observer = owned.process.terminal_observer();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !stderr
            .receipts()
            .iter()
            .any(|receipt| receipt.stderr_complete)
        {
            assert!(Instant::now() < deadline, "actual child must close stderr");
            std::thread::sleep(Duration::from_millis(5));
        }
        // Wait for the controlled fixture's kernel exit in setup, before any
        // application classification. The opaque proof still comes from the
        // exact retained SDK Child, never a copied observation or fake bool.
        loop {
            if let Some(proof) = owned.process.observe_preclose_terminal().unwrap() {
                assert_eq!(
                    proof.observation().stderr_receipts.as_ref().unwrap()[0].stderr,
                    b"whole native stderr\n"
                );
                return (proof, observer);
            }
            assert!(
                Instant::now() < deadline,
                "actual child must become terminal"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn preclose_inventory_requires_a_bijection_of_real_opaque_owner_tokens() {
        let (first, first_observer) = real_terminal_proof();
        let (other, other_observer) = real_terminal_proof();
        let proofs = [first.clone(), other.clone()];
        assert!(
            validate_preclose_inventory(
                &proofs,
                &[first_observer.clone(), other_observer.clone()],
                &[]
            )
            .is_ok()
        );
        assert!(
            validate_preclose_inventory(
                &proofs,
                &[first_observer.clone(), first_observer.clone()],
                &[]
            )
            .is_err()
        );
        assert!(
            validate_preclose_inventory(
                &[first.clone(), first.clone()],
                &[first_observer.clone(), other_observer.clone()],
                &[]
            )
            .is_err()
        );
        assert!(validate_preclose_inventory(&[first], &[other_observer], &[]).is_err());
        assert!(validate_preclose_inventory(&[], &[], &[]).is_err());
    }

    #[test]
    fn preclose_attachment_requires_the_real_owner_epoch_and_complete_socket_session() {
        let (proof, observer) = real_terminal_proof();
        let observation = proof.observation();
        let valid = json!({"ownership":"attached","apiRole":"project-api","ownerExpectedPid":observation.expected_pid,"ownerSpawnSequence":observation.spawn_sequence,"attachment":{"pipe":"controlled pipe","sessionId":"controlled session"}});
        assert!(
            validate_preclose_inventory(
                std::slice::from_ref(&proof),
                std::slice::from_ref(&observer),
                std::slice::from_ref(&valid)
            )
            .is_ok()
        );
        for (field, value) in [
            (
                "ownerExpectedPid",
                json!(u64::from(observation.expected_pid) + 1),
            ),
            ("ownerSpawnSequence", json!(observation.spawn_sequence + 1)),
            ("ownership", json!("owned")),
            ("attachment", Value::Null),
            (
                "attachment",
                json!({"pipe":"", "sessionId":"controlled session"}),
            ),
            (
                "attachment",
                json!({"pipe":"controlled pipe", "sessionId":null}),
            ),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = value;
            assert!(
                validate_preclose_inventory(
                    std::slice::from_ref(&proof),
                    std::slice::from_ref(&observer),
                    &[invalid]
                )
                .is_err(),
                "must reject invalid {field}"
            );
        }
    }
}
