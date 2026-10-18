//! Retired configurations retain exact process custody through close acknowledgment.
use futures::{
    FutureExt, StreamExt,
    channel::{mpsc, oneshot},
    executor::LocalPool,
    future::{BoxFuture, Shared},
    task::LocalSpawnExt,
};
use parking_lot::Mutex;
use std::sync::{Arc, OnceLock};
use vize_canon::{CorsaBridge, NativePreCloseEpoch, NativeRetirementOutcome};
use vize_l0::{String, cstr};

type Completion = Shared<BoxFuture<'static, Result<NativeRetirementOutcome, String>>>;
type Job = (
    Arc<CorsaBridge>,
    Option<NativePreCloseEpoch>,
    oneshot::Sender<Result<NativeRetirementOutcome, String>>,
);

#[derive(Clone)]
struct Owner {
    bridge: Arc<CorsaBridge>,
    completion: Completion,
    preclose: Option<NativePreCloseEpoch>,
}

#[derive(Default)]
struct State {
    owners: Vec<Owner>,
}

/// Root and package contexts share this ledger, including contexts already removed from caches.
#[derive(Clone, Default)]
pub(in crate::server::state) struct RetiredOwners(Arc<Mutex<State>>);

impl RetiredOwners {
    /// The caller still holds the cached-owner slot. Never close IPC on this path.
    pub(in crate::server::state) fn retain_and_close(&self, bridge: Arc<CorsaBridge>) {
        self.retain_owner(bridge, None);
    }

    pub(in crate::server::state) fn retain_preexisting(&self, epoch: NativePreCloseEpoch) {
        self.retain_owner(Arc::clone(epoch.bridge()), Some(epoch));
    }

    fn retain_owner(&self, bridge: Arc<CorsaBridge>, preclose: Option<NativePreCloseEpoch>) {
        let mut state = self.0.lock();
        observe_completed(&mut state);
        if state
            .owners
            .iter()
            .any(|owner| Arc::ptr_eq(&owner.bridge, &bridge))
        {
            return;
        }
        let (reply, response) = oneshot::channel();
        let completion = async move {
            response.await.unwrap_or_else(|error| {
                Err(cstr!(
                    "Retired native close worker did not acknowledge completion: {error}"
                ))
            })
        }
        .boxed()
        .shared();
        state.owners.push(Owner {
            bridge: bridge.clone(),
            completion,
            preclose: preclose.clone(),
        });
        // A failed enqueue still leaves the exact owner and a failed completion
        // in the ledger. Final exit retries cleanup without erasing this error.
        match closer() {
            Ok(sender) => {
                if let Err(error) = sender.unbounded_send((bridge, preclose, reply)) {
                    let (_, _, reply) = error.into_inner();
                    let _ = reply.send(Err(cstr!("Retired native close executor stopped")));
                }
            }
            Err(error) => {
                let _ = reply.send(Err(error.clone()));
            }
        }
    }

    pub(in crate::server::state) async fn close_for_exit(&self) -> Result<(), String> {
        let owners = {
            let mut state = self.0.lock();
            observe_completed(&mut state);
            state.owners.clone()
        };
        let outcomes = futures::future::join_all(owners.iter().map(|owner| async {
            let prior = owner.completion.clone().await;
            if prior.as_ref().is_ok_and(|outcome| outcome.custody_complete) {
                return Ok(());
            }
            // Ordinary request/close failures remain visible. A retry may
            // establish exact terminal custody later, without relabeling the
            // old protocol result as a graceful success.
            tracing::warn!(prior = ?prior, "retrying incomplete retired native custody");
            let retry = owner
                .bridge
                .shutdown_for_retirement()
                .await
                .map_err(|error| {
                    cstr!(
                        "Retired native cleanup retry failed: {error}; previous attempt: {prior:?}"
                    )
                })?;
            let retry = with_preclose(retry, owner.preclose.as_ref());
            publish(&retry);
            if retry.custody_complete {
                Ok(())
            } else {
                Err(cstr!(
                    "Retired native owner lacks terminal custody: {:?}",
                    retry.receipt
                ))
            }
        }))
        .await;
        let mut state = self.0.lock();
        let mut failures = Vec::new();
        for (owner, outcome) in owners.iter().zip(outcomes) {
            match outcome {
                Ok(()) => state
                    .owners
                    .retain(|entry| !Arc::ptr_eq(&entry.bridge, &owner.bridge)),
                Err(error) => failures.push(error),
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(cstr!(
                "Retired native ownership is incomplete: {failures:?}"
            ))
        }
    }
}

fn observe_completed(state: &mut State) {
    state
        .owners
        .retain(|owner| !matches!(owner.completion.clone().now_or_never(), Some(Ok(outcome)) if outcome.custody_complete));
}

fn publish(outcome: &NativeRetirementOutcome) {
    tracing::info!(receipt = %outcome.receipt, "retired native owner terminal custody");
}

fn with_preclose(
    mut outcome: NativeRetirementOutcome,
    preclose: Option<&NativePreCloseEpoch>,
) -> NativeRetirementOutcome {
    if let Some(epoch) = preclose {
        attach_preclose_receipt(&mut outcome, epoch.receipt());
    }
    outcome
}

/// Invalid receipt shapes remain observable and cannot release the retirement ledger.
fn attach_preclose_receipt(outcome: &mut NativeRetirementOutcome, preclose: serde_json::Value) {
    if let Some(receipt) = outcome.receipt.as_object_mut() {
        receipt.insert("preexistingEpoch".into(), preclose);
    } else {
        outcome.custody_complete = false;
        outcome.raw_errors.push(cstr!(
            "Cannot attach preclose custody to a non-object retirement receipt"
        ));
        outcome.receipt = serde_json::json!({
            "invalidReceipt": outcome.receipt,
            "preexistingEpoch": preclose,
            "custody_complete": false,
            "raw_errors": outcome.raw_errors,
        });
    }
}

/// One nonblocking executor serves all retired epochs. Configuration discovery
/// keeps its own workers, and an abandoned RPC cannot block another owner close.
fn closer() -> Result<&'static mpsc::UnboundedSender<Job>, &'static String> {
    static CLOSER: OnceLock<Result<mpsc::UnboundedSender<Job>, String>> = OnceLock::new();
    CLOSER
        .get_or_init(|| {
            let (sender, mut jobs) = mpsc::unbounded::<Job>();
            std::thread::Builder::new()
                .name("vize-retired-native-close".into())
                .spawn(move || {
                    let mut pool = LocalPool::new();
                    let spawner = pool.spawner();
                    pool.run_until(async move {
                        while let Some((bridge, preclose, reply)) = jobs.next().await {
                            if let Err(error) = spawner.spawn_local(async move {
                                let outcome =
                                    bridge.shutdown_for_retirement().await.map_err(|error| {
                                        cstr!("Retired native owner close failed: {error}")
                                    });
                                let outcome = outcome
                                    .map(|outcome| with_preclose(outcome, preclose.as_ref()));
                                match &outcome {
                                    Ok(outcome) => publish(outcome),
                                    Err(error) => tracing::warn!(
                                        "retired native close attempt failed: {error}"
                                    ),
                                }
                                let _ = reply.send(outcome);
                            }) {
                                tracing::error!("cannot schedule retired native close: {error}");
                            }
                        }
                    });
                    pool.run();
                })
                .map(|_| sender)
                .map_err(|error| cstr!("Cannot start retired native close executor: {error}"))
        })
        .as_ref()
}

#[cfg(test)]
mod tests {
    use super::{NativeRetirementOutcome, attach_preclose_receipt};
    use serde_json::json;
    use vize_l0::cstr;

    #[test]
    fn preclose_receipt_preserves_the_complete_object_and_frozen_epoch() {
        let original = json!({"children": [{"raw_errors": ["original RPC failure"], "stderr": [0, 255]}], "raw_errors": ["original RPC failure"], "custody_complete": true});
        let epoch = json!({"criterion": "frozen epoch", "children": [{"stderr": [0, 255]}]});
        let mut outcome = NativeRetirementOutcome {
            custody_complete: true,
            raw_errors: vec![cstr!("original RPC failure")],
            receipt: original,
        };
        attach_preclose_receipt(&mut outcome, epoch.clone());
        assert_eq!(
            json!({"custody_complete": outcome.custody_complete, "raw_errors": outcome.raw_errors, "receipt": outcome.receipt}),
            json!({"custody_complete": true, "raw_errors": ["original RPC failure"], "receipt": {"children": [{"raw_errors": ["original RPC failure"], "stderr": [0, 255]}], "raw_errors": ["original RPC failure"], "custody_complete": true, "preexistingEpoch": epoch}}),
        );
    }

    #[test]
    fn preclose_receipt_refuses_non_objects_and_publishes_all_original_evidence() {
        for original in [
            json!(null),
            json!(false),
            json!(17),
            json!("invalid"),
            json!([]),
            json!([0, 255]),
        ] {
            let epoch = json!({"criterion": "frozen epoch", "children": [{"stderr": [0, 255]}]});
            let mut outcome = NativeRetirementOutcome {
                custody_complete: true,
                raw_errors: vec![cstr!("original RPC failure")],
                receipt: original.clone(),
            };
            attach_preclose_receipt(&mut outcome, epoch.clone());
            assert_eq!(
                json!({"custody_complete": outcome.custody_complete, "raw_errors": outcome.raw_errors, "receipt": outcome.receipt}),
                json!({"custody_complete": false, "raw_errors": ["original RPC failure", "Cannot attach preclose custody to a non-object retirement receipt"], "receipt": {"invalidReceipt": original, "preexistingEpoch": epoch, "custody_complete": false, "raw_errors": ["original RPC failure", "Cannot attach preclose custody to a non-object retirement receipt"]}}),
            );
        }
    }
}
