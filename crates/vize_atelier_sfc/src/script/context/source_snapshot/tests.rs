use super::TypeSourceSnapshot;
use std::sync::Arc;

#[test]
fn overlay_text_is_shared_and_a_snapshot_freezes_disk_reads_and_misses() {
    let dir = tempfile::tempdir().unwrap();
    let overlay = dir.path().join("open.ts");
    let disk = dir.path().join("saved.ts");
    let missing = dir.path().join("missing.ts");
    let text: Arc<str> = Arc::from("export type Open = number");
    let sources = TypeSourceSnapshot::new([(overlay.clone(), Arc::clone(&text))]);
    let read = sources.read(&overlay).unwrap();
    assert!(Arc::ptr_eq(&text, &read));
    std::fs::write(&disk, "export type Saved = string").unwrap();
    assert_eq!(
        sources.read(&disk).as_deref(),
        Some("export type Saved = string")
    );
    assert_eq!(sources.read(&missing).as_deref(), None);
    std::fs::write(&disk, "export type Saved = number").unwrap();
    std::fs::write(&missing, "export type New = boolean").unwrap();
    assert_eq!(
        sources.read(&disk).as_deref(),
        Some("export type Saved = string")
    );
    assert_eq!(sources.read(&missing).as_deref(), None);
    let fresh = TypeSourceSnapshot::default();
    assert_eq!(
        fresh.read(&disk).as_deref(),
        Some("export type Saved = number")
    );
    assert_eq!(
        fresh.read(&missing).as_deref(),
        Some("export type New = boolean")
    );
}

#[test]
fn new_unsaved_modules_follow_disk_extension_precedence_and_js_substitution() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("App.vue");
    let existing = dir.path().join("api.ts");
    let unsaved_lower = dir.path().join("api.tsx");
    let unsaved_new = dir.path().join("new.ts");
    std::fs::write(&existing, "export type Existing = number").unwrap();
    let sources = TypeSourceSnapshot::new([
        (
            unsaved_lower,
            Arc::<str>::from("export type Lower = string"),
        ),
        (
            unsaved_new.clone(),
            Arc::<str>::from("export type New = boolean"),
        ),
    ]);
    assert_eq!(
        sources.resolve_import(&root, "./api"),
        Some(existing.canonicalize().unwrap())
    );
    assert_eq!(sources.resolve_import(&root, "./new.js"), Some(unsaved_new));
}

#[test]
fn concurrent_readers_share_one_captured_disk_source() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared.ts");
    std::fs::write(&path, "export type Shared = string").unwrap();
    let sources = TypeSourceSnapshot::default();
    let start = std::sync::Barrier::new(16);
    let reads = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..16)
            .map(|_| {
                scope.spawn(|| {
                    start.wait();
                    sources.read(&path).unwrap()
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>()
    });
    for source in &reads {
        assert_eq!(source.as_ref(), "export type Shared = string");
        assert!(Arc::ptr_eq(&reads[0], source));
    }
    std::fs::write(&path, "export type Shared = number").unwrap();
    assert!(Arc::ptr_eq(&reads[0], &sources.read(&path).unwrap()));
    assert_eq!(
        TypeSourceSnapshot::default().read(&path).as_deref(),
        Some("export type Shared = number")
    );
}

#[cfg(unix)]
#[test]
fn blocked_disk_read_does_not_block_an_unrelated_dependency() {
    use std::io::Write;
    use std::sync::mpsc;
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let blocked = dir.path().join("blocked.ts");
    let independent = dir.path().join("independent.ts");
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&blocked)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(&independent, "export type Independent = boolean").unwrap();
    let sources = Arc::new(TypeSourceSnapshot::default());
    let blocked_sources = Arc::clone(&sources);
    let blocked_path = blocked.clone();
    let blocked_reader = std::thread::spawn(move || blocked_sources.read(&blocked_path));
    // Opening the writer completes only after the reader enters filesystem I/O.
    // Keep it open without bytes so that the source read cannot finish yet.
    let mut writer = std::fs::OpenOptions::new()
        .write(true)
        .open(&blocked)
        .unwrap();
    let (ready, completed) = mpsc::channel();
    let independent_sources = Arc::clone(&sources);
    let independent_reader = std::thread::spawn(move || {
        ready.send(independent_sources.read(&independent)).unwrap();
    });
    let observed = completed.recv_timeout(Duration::from_secs(5));
    // Release and join both readers even when the concurrency assertion fails.
    writer.write_all(b"export type Blocked = number").unwrap();
    drop(writer);
    let captured = blocked_reader.join().unwrap();
    independent_reader.join().unwrap();
    assert_eq!(captured.as_deref(), Some("export type Blocked = number"));
    assert_eq!(
        observed.unwrap().as_deref(),
        Some("export type Independent = boolean")
    );
}
