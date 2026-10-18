//! Real host-side preclose allocation and full evidence, isolated from libtest.
use std::alloc::System;
use vize_l0::profiler::ProfilingAllocator;

#[global_allocator]
static ALLOCATOR: ProfilingAllocator<System> = ProfilingAllocator::from_allocator(System);

fn main() {
    #[cfg(unix)]
    unix::run();
    #[cfg(not(unix))]
    {
        if std::env::args().any(|arg| arg == "--list") {
            return;
        }
        panic!("corsa_process_allocation requires the declared Unix ownership fixture");
    }
}

#[cfg(unix)]
mod unix {
    use corsa::process::{
        AsyncChildGuard, CorsaCommand, ProcessCloseObservation, ProcessLifetimeObserver,
    };
    use corsa_lsp::process::ProcessObserver;
    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};
    use std::{
        hint::black_box,
        io::{BufRead, BufReader, Write},
        os::unix::process::ExitStatusExt,
        sync::Arc,
        time::{Duration, Instant},
    };
    use vize_l0::profiler::{
        AllocationSnapshot, allocation_snapshot, reset_allocation_counters,
        set_allocation_tracking_enabled,
    };

    const CASE: &str =
        "borrowed_preclose_preserves_full_custody_without_discarded_copy_allocations";
    const ORIGINAL: &str = "406a0c412eda661aabadf954e5cf02df58db22e9";
    const SOURCES: [(&str, &[u8], &str); 3] = [
        (
            "vendor/corsa_core/src/process/guard.rs",
            include_bytes!("../../../vendor/corsa_core/src/process/guard.rs"),
            "1be26f595f61f67fa339b0aa0fb71bdea2b4bb269c36bdb5395c8fdcbdd411e7",
        ),
        (
            "vendor/corsa_core/src/process/lifetime.rs",
            include_bytes!("../../../vendor/corsa_core/src/process/lifetime.rs"),
            "fc534f53489b5060a0da06ac3bed8a22609474701ed39c4596dfc878fb072162",
        ),
        (
            "vendor/corsa_core/src/process_receipt.rs",
            include_bytes!("../../../vendor/corsa_core/src/process_receipt.rs"),
            "23caf15b31def5fa890e5b860983d646cc111c3fcae3ed5548e4fe87f02d7337",
        ),
    ];

    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn measure<T>(call: impl FnOnce() -> T) -> (T, AllocationSnapshot) {
        set_allocation_tracking_enabled(false);
        reset_allocation_counters();
        set_allocation_tracking_enabled(true);
        let result = black_box(call());
        let counters = allocation_snapshot();
        set_allocation_tracking_enabled(false);
        (result, counters)
    }

    fn zero(counters: &AllocationSnapshot) -> bool {
        counters.allocation_calls() == 0
            && counters.requested_bytes() == 0
            && counters.allocation_failures() == 0
    }

    fn metrics(counters: &AllocationSnapshot) -> Value {
        json!({"allocationCalls":counters.allocation_calls(),"requestedBytes":counters.requested_bytes(),
            "allocationFailures":counters.allocation_failures(),"alloc":counters.alloc_calls,
            "allocZeroed":counters.alloc_zeroed_calls,"realloc":counters.realloc_calls,
            "allocBytes":counters.alloc_bytes,"zeroedBytes":counters.alloc_zeroed_bytes,
            "reallocBytes":counters.realloc_new_bytes,"reallocOldBytes":counters.realloc_old_bytes,
            "allocFailures":counters.alloc_failures,"zeroedFailures":counters.alloc_zeroed_failures,
            "reallocFailures":counters.realloc_failures,"deallocCalls":counters.dealloc_calls,
            "deallocBytes":counters.dealloc_bytes})
    }

    fn packet(observation: &ProcessCloseObservation) -> Value {
        json!({"spawnSequence":observation.spawn_sequence,"expectedPid":observation.expected_pid,
            "context":observation.context,"rawErrors":observation.raw_errors,"closeError":observation.close_error,
            "terminal":observation.terminal.as_ref().map(|row| json!({"pid":row.pid,
                "exitCode":row.status.code(),"signal":row.status.signal(),"reaped":row.reaped,
                "timedOut":row.timed_out,"killRequested":row.kill_requested})),
            "stderr":observation.stderr_receipts.as_ref().map(|rows| rows.iter().map(|row| json!({
                "pid":row.pid,"bytes":row.stderr,"complete":row.completed,"stderrComplete":row.stderr_complete,
                "stderrError":row.stderr_error,"processError":row.process_error,"exitCode":row.exit_status.and_then(|s|s.code()),
                "signal":row.exit_status.and_then(|s|s.signal()),"reaped":row.reaped,
                "timedOut":row.timed_out,"killRequested":row.kill_requested,"elapsedNs":row.elapsed.as_nanos()})).collect::<Vec<_>>())})
    }

    fn wait_for(mut ready: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready() {
            assert!(Instant::now() < deadline, "actual custody did not settle");
            std::thread::yield_now();
        }
    }

    struct Fixture {
        process: Arc<AsyncChildGuard>,
        stderr: ProcessObserver,
        stdin: std::process::ChildStdin,
        bytes: Vec<u8>,
        errors: Vec<String>,
        context: String,
        pid: u32,
    }

    fn fixture(large: bool) -> Fixture {
        let stderr = ProcessObserver::default();
        let context = if large {
            "preowned context".repeat(1024)
        } else {
            String::new()
        };
        let command = CorsaCommand::new("sh")
            .with_process_observer(stderr.clone())
            .with_lifetime_observer(ProcessLifetimeObserver::default(), context.as_str());
        let program = if large {
            r#"i=0; while [ "$i" -lt 8192 ]; do printf '\377\000payload' >&2; i=$((i+1)); done; printf '%s\n' "$$"; read command; kill -KILL $$"#
        } else {
            r#"printf '%s\n' "$$"; read command; kill -KILL $$"#
        };
        let owned = command
            .spawn_guarded(["-c", program])
            .expect("real exact child required");
        let mut ready = String::new();
        BufReader::new(owned.stdout).read_line(&mut ready).unwrap();
        let pid: u32 = ready.trim().parse().expect("actual child PID line");
        assert!(pid > 0);
        let bytes = if large {
            b"\xff\0payload".repeat(8192)
        } else {
            Vec::new()
        };
        wait_for(|| {
            stderr
                .receipts()
                .first()
                .is_some_and(|row| row.stderr == bytes)
        });
        let errors = if large {
            vec![
                "preowned first error".repeat(1024),
                "preowned second error".repeat(1024),
            ]
        } else {
            Vec::new()
        };
        let observer = owned.process.terminal_observer();
        for error in &errors {
            observer.record_error(error.clone());
        }
        let prepared = observer.snapshot();
        assert_eq!(prepared.expected_pid, pid);
        assert_eq!(prepared.raw_errors, errors);
        assert_eq!(prepared.context.as_str(), context);
        assert!(prepared.terminal.is_none());
        Fixture {
            process: owned.process,
            stderr,
            stdin: owned.stdin,
            bytes,
            errors,
            context,
            pid,
        }
    }

    pub(super) fn run() {
        let args = std::env::args().skip(1).collect::<Vec<_>>();
        let mut list = false;
        let mut ignored = false;
        let mut filter = None;
        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "--list" => list = true,
                "--ignored" => ignored = true,
                "--exact" | "--nocapture" => {}
                "--format" if args.get(index + 1).is_some_and(|s| s == "terse") => index += 1,
                value if !value.starts_with('-') && filter.is_none() => filter = Some(value),
                _ => panic!("unsupported standalone harness arguments: {args:?}"),
            }
            index += 1;
        }
        assert!(
            filter.is_none_or(|value| value == CASE),
            "unknown exact allocation case"
        );
        if ignored {
            return;
        }
        if list {
            println!("{CASE}: test");
            return;
        }
        let arm = std::env::var("VIZE_CORSA_ALLOCATION_ARM").unwrap_or_else(|_| "borrowed".into());
        assert!(matches!(arm.as_str(), "borrowed" | "copying"));
        let source_images = SOURCES
            .iter()
            .map(|(path, bytes, original)| {
                let digest = hash(bytes);
                if arm == "copying" {
                    assert_eq!(&digest, original, "whole immutable production body");
                }
                json!({"path":path,"sha256":digest})
            })
            .collect::<Vec<_>>();
        let (probe, probe_counts) = measure(|| black_box(Vec::<u8>::with_capacity(4096)));
        assert!(probe.capacity() >= 4096);
        assert!(
            !zero(&probe_counts) && probe_counts.requested_bytes() >= 4096,
            "counter must be live"
        );
        let clone_input = vec![0u8, 255, 1].repeat(4096);
        let (clone, clone_counts) = measure(|| black_box(clone_input.clone()));
        assert_eq!(clone, clone_input);
        assert!(
            !zero(&clone_counts),
            "token-free clone must fail zero validator"
        );
        let mut observations = Vec::new();
        let mut previous = None;
        for large in [false, true] {
            let Fixture {
                process,
                stderr,
                mut stdin,
                bytes,
                errors,
                context,
                pid,
            } = fixture(large);
            let observer = process.terminal_observer();
            let before = packet(&observer.snapshot());
            let (result, counts) = measure(|| process.observe_preclose_terminal());
            assert!(
                result.expect("same accessible child custody").is_none(),
                "genuine child stays alive"
            );
            let after = packet(&observer.snapshot());
            assert_eq!(before, after, "probe must not mutate or consume evidence");
            if arm == "borrowed" {
                assert!(zero(&counts), "borrowed whole probe allocated: {counts:?}");
            }
            if arm == "copying" {
                assert!(
                    !zero(&counts),
                    "original observed receipt copy must allocate"
                );
            }
            stdin.write_all(b"exit\n").unwrap();
            wait_for(|| stderr.receipts()[0].stderr_complete);
            let mut proof = None;
            wait_for(|| {
                proof = process
                    .observe_preclose_terminal()
                    .expect("full terminal custody");
                proof.is_some()
            });
            let proof = proof.unwrap();
            let terminal = proof.observation();
            assert!(terminal.custody_complete());
            assert_eq!(terminal.raw_errors, errors);
            assert_eq!(terminal.context.as_str(), context);
            let row = terminal.terminal.as_ref().unwrap();
            assert_eq!(row.pid, pid);
            assert_eq!(row.status.signal(), Some(9));
            assert!(row.reaped && !row.kill_requested && !row.timed_out);
            let receipts = terminal.stderr_receipts.as_ref().unwrap();
            assert_eq!(receipts.len(), 1);
            assert_eq!(receipts[0].pid, pid);
            assert_eq!(receipts[0].stderr, bytes);
            assert_eq!(receipts[0].exit_status, Some(row.status));
            assert!(receipts[0].completed && receipts[0].stderr_complete && receipts[0].reaped);
            assert!(receipts[0].stderr_error.is_none() && receipts[0].process_error.is_none());
            assert!(!receipts[0].kill_requested && !receipts[0].timed_out);
            let frozen = packet(terminal);
            if large {
                assert!(previous.is_some(), "genuine foreign owner required");
            }
            let (identity, identity_counts) = measure(|| {
                (
                    proof.matches(&observer, terminal.spawn_sequence),
                    proof.matches(&observer, terminal.spawn_sequence + 1),
                    previous
                        .as_ref()
                        .is_none_or(|other| !proof.matches(other, terminal.spawn_sequence)),
                    proof.observation().custody_complete(),
                )
            });
            assert_eq!(identity, (true, false, true, true));
            assert!(zero(&identity_counts));
            let (owned_snapshot, owned_counts) = measure(|| observer.snapshot());
            if large {
                assert!(!zero(&owned_counts), "full owned evidence was not copied");
            }
            assert_eq!(packet(&owned_snapshot), frozen);
            observer.record_error("later mutable evidence");
            assert_eq!(
                packet(proof.observation()),
                frozen,
                "proof remains inert and complete"
            );
            assert_eq!(
                packet(&owned_snapshot),
                frozen,
                "owned snapshot remains independent"
            );
            assert!(
                process.observe_preclose_terminal().is_err(),
                "consumed child cannot manufacture another proof"
            );
            previous = Some(observer);
            observations.push(
                json!({"large":large,"aliveBefore":before,"aliveAfter":after,
                "probeMetrics":metrics(&counts),"identityMetrics":metrics(&identity_counts),
                "ownedSnapshotMetrics":metrics(&owned_counts),"wholeTerminal":frozen}),
            );
        }
        let executable = std::env::current_exe().unwrap();
        let executable_hash = hash(&std::fs::read(&executable).unwrap());
        println!(
            "{}",
            json!({"case":CASE,"arm":arm,"original":ORIGINAL,
            "scope":"Rust host-side exact child custody, not native TypeScript speed or public acceptance",
            "sourceSha":std::env::var("GITHUB_SHA").ok(),"productionSources":source_images,
            "actorSha256":hash(include_bytes!("corsa_process_allocation.rs")),
            "testBinary":executable,"testBinarySha256":executable_hash,
            "counterProbe":metrics(&probe_counts),"cloneNegative":metrics(&clone_counts),"observations":observations})
        );
        println!("{CASE}: PASS ({arm})");
    }
}
