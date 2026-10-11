//! Private, bounded diagnostic counters. Never used as production acceptance.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

static QUERIES: AtomicU64 = AtomicU64::new(0);
static FIRST: AtomicBool = AtomicBool::new(true);
static OUTPUT: OnceLock<Option<Mutex<Output>>> = OnceLock::new();

struct Output {
    file: File,
    sequence: u64,
}

#[derive(Serialize)]
struct Record<'a> {
    sequence: u64,
    pid: u32,
    wall_ns: u128,
    query_ordinal: u64,
    scope: &'static str,
    boundary: &'static str,
    source_uri: Option<&'a str>,
    source_bytes: Option<usize>,
    thread: Option<&'a str>,
    allocation_calls: u64,
    requested_bytes: u64,
    released_bytes: u64,
    approximate_net_bytes: i128,
    allocation_failures: u64,
}

fn output() -> Option<&'static Mutex<Output>> {
    OUTPUT
        .get_or_init(|| {
            let directory = std::env::var_os("VIZE_LSP_ALLOCATION_TRACE_DIR")?;
            let directory = std::path::PathBuf::from(directory);
            let file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(directory.join(format!("{}.jsonl", std::process::id())))
                .expect("a fresh diagnostic output directory must exist");
            Some(Mutex::new(Output { file, sequence: 0 }))
        })
        .as_ref()
}

fn mark(
    scope: &'static str,
    boundary: &'static str,
    source_uri: Option<&str>,
    source_bytes: Option<usize>,
) {
    let Some(output) = output() else { return };
    let mut output = output.lock().expect("diagnostic writer mutex");
    output.sequence += 1;
    assert!(output.sequence <= 4096, "bounded diagnostic event quota");
    let snapshot = vize_l0::profiler::allocation_snapshot();
    let thread = std::thread::current();
    let record = Record {
        sequence: output.sequence,
        pid: std::process::id(),
        wall_ns: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("diagnostic wall clock")
            .as_nanos(),
        query_ordinal: QUERIES.load(Ordering::Relaxed),
        scope,
        boundary,
        source_uri,
        source_bytes,
        thread: thread.name(),
        allocation_calls: snapshot.allocation_calls(),
        requested_bytes: snapshot.requested_bytes(),
        released_bytes: snapshot.released_bytes(),
        approximate_net_bytes: snapshot.net_bytes(),
        allocation_failures: snapshot.allocation_failures(),
    };
    // Logger initialization and any serialization allocations remain in the
    // counters. No reset, subtraction, allocation suppression or heap trim.
    serde_json::to_writer(&mut output.file, &record).expect("diagnostic record");
    output.file.write_all(b"\n").expect("diagnostic newline");
}

pub(crate) struct Span<'a> {
    scope: &'static str,
    source_uri: Option<&'a str>,
}

impl Drop for Span<'_> {
    fn drop(&mut self) {
        mark(self.scope, "end", self.source_uri, None);
    }
}

pub(crate) fn span<'a>(scope: &'static str, source_uri: Option<&'a str>) -> Span<'a> {
    mark(scope, "begin", source_uri, None);
    Span { scope, source_uri }
}

pub(crate) fn query() -> Span<'static> {
    QUERIES.fetch_add(1, Ordering::Relaxed);
    span("workspace-query", None)
}

pub(crate) fn first_collector() -> bool {
    FIRST.swap(false, Ordering::Relaxed)
}

pub(crate) fn loaded(source_uri: &str, source_bytes: usize) {
    mark("source", "loaded", Some(source_uri), Some(source_bytes));
}
