//! Root-owned, coalesced configuration watches; no server state enters the worker.
#![expect(
    clippy::disallowed_types,
    reason = "the root and its one OS worker share only a bounded queue"
)]

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;

use futures::FutureExt;
use futures::channel::oneshot;
use futures::future::{Either, select};
use parking_lot::{Condvar, Mutex};
use tower_lsp::Client;
use tower_lsp::lsp_types::{
    ClientCapabilities, DidChangeWatchedFilesRegistrationOptions, FileSystemWatcher, GlobPattern,
    OneOf, Registration, RelativePattern, Unregistration, Url, WatchKind,
};
use vize_carton::{String, cstr};

const METHOD: &str = "workspace/didChangeWatchedFiles";

#[derive(Default)]
struct Queue {
    supported: bool,
    started: bool,
    closed: bool,
    latest: Option<Vec<PathBuf>>,
    stop: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
struct Shared {
    queue: Mutex<Queue>,
    ready: Condvar,
}

/// Foreground operations only replace desired paths or signal the single worker.
#[derive(Default)]
pub(in crate::server) struct Control {
    shared: Arc<Shared>,
}

impl Control {
    pub(in crate::server) fn record_capabilities(&self, capabilities: &ClientCapabilities) {
        let watched = capabilities
            .workspace
            .as_ref()
            .and_then(|workspace| workspace.did_change_watched_files.as_ref());
        self.shared.queue.lock().supported = watched.is_some_and(|watch| {
            watch.dynamic_registration == Some(true) && watch.relative_pattern_support == Some(true)
        });
    }

    pub(in crate::server) fn start(&self, client: Client) {
        let (stop, cancelled) = oneshot::channel();
        {
            let mut queue = self.shared.queue.lock();
            if queue.closed || queue.started || !queue.supported {
                return;
            }
            queue.started = true;
            queue.stop = Some(stop);
        }
        let shared = Arc::clone(&self.shared);
        if let Err(error) = std::thread::Builder::new()
            .name("vize-config-watch".into())
            .spawn(move || {
                Worker::new(client, cancelled).run(shared);
            })
        {
            {
                let mut queue = self.shared.queue.lock();
                queue.started = false;
                queue.stop.take();
            }
            tracing::warn!("failed to spawn configuration watch worker: {error}");
        }
    }

    pub(in crate::server) fn update(&self, mut paths: Vec<PathBuf>) {
        paths.sort();
        paths.dedup();
        let previous = {
            let mut queue = self.shared.queue.lock();
            if queue.closed || !queue.supported {
                return;
            }
            queue.latest.replace(paths)
        };
        drop(previous);
        self.shared.ready.notify_one();
    }

    pub(in crate::server) fn shutdown(&self) {
        let (stop, discarded) = {
            let mut queue = self.shared.queue.lock();
            queue.closed = true;
            (queue.stop.take(), queue.latest.take())
        };
        drop(discarded);
        if let Some(stop) = stop {
            let _ = stop.send(());
        }
        self.shared.ready.notify_one();
    }
}

impl Drop for Control {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Generation {
    id: String,
    paths: Vec<PathBuf>,
}

struct Worker {
    client: Client,
    cancelled: oneshot::Receiver<()>,
    sequence: u64,
    active: Option<Generation>,
    obsolete: Option<String>,
    pending: Option<String>,
}

impl Worker {
    fn new(client: Client, cancelled: oneshot::Receiver<()>) -> Self {
        Self {
            client,
            cancelled,
            sequence: 0,
            active: None,
            obsolete: None,
            pending: None,
        }
    }

    fn run(mut self, shared: Arc<Shared>) {
        loop {
            let paths = {
                let mut queue = shared.queue.lock();
                while !queue.closed && queue.latest.is_none() {
                    shared.ready.wait(&mut queue);
                }
                if queue.closed {
                    break;
                }
                queue.latest.take()
            };
            if let Some(paths) = paths {
                if !self.replace(paths) {
                    break;
                }
            }
        }
        self.dispose();
    }

    /// Failed cleanup waits for another ordinary update, never a retry loop.
    fn cleanup(&mut self) -> Option<bool> {
        let Some(id) = self.obsolete.as_ref() else {
            return Some(true);
        };
        match wait_rpc(
            &mut self.cancelled,
            self.client.unregister_capability(vec![unregistration(id)]),
        )? {
            Ok(()) => {
                self.obsolete = None;
                Some(true)
            }
            Err(error) => {
                tracing::warn!("failed to retire configuration watch {id}: {error}");
                Some(false)
            }
        }
    }

    /// At most one active ACKed generation and one obsolete ACKed ID are retained.
    fn replace(&mut self, paths: Vec<PathBuf>) -> bool {
        match self.cleanup() {
            None => return false,
            Some(false) => return true,
            Some(true) => {}
        }
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.paths == paths)
        {
            return true;
        }
        if paths.is_empty() {
            self.obsolete = self.active.take().map(|active| active.id);
            return self.cleanup().is_some();
        }
        let Some(watchers) = watchers(&paths) else {
            tracing::warn!(
                "configuration watch paths must have absolute file parents and UTF-8 names"
            );
            return true;
        };
        self.sequence += 1;
        let id = cstr!("vize-config-watch-{}", self.sequence);
        let options = DidChangeWatchedFilesRegistrationOptions { watchers };
        let registration = Registration {
            id: id.clone().into(),
            method: METHOD.into(),
            register_options: match serde_json::to_value(options) {
                Ok(options) => Some(options),
                Err(error) => {
                    tracing::warn!("cannot encode configuration watches: {error}");
                    return true;
                }
            },
        };
        self.pending = Some(id.clone());
        match wait_rpc(
            &mut self.cancelled,
            self.client.register_capability(vec![registration]),
        ) {
            None => return false,
            Some(Err(error)) => {
                self.pending = None;
                tracing::warn!("failed to register configuration watch {id}: {error}");
                return true;
            }
            Some(Ok(())) => self.pending = None,
        }
        self.obsolete = self
            .active
            .replace(Generation { id, paths })
            .map(|active| active.id);
        self.cleanup().is_some()
    }

    /// One nonblocking best-effort send per known ID; no unobserved ACK is claimed.
    fn dispose(self) {
        let ids = self
            .active
            .map(|active| active.id)
            .into_iter()
            .chain(self.obsolete)
            .chain(self.pending);
        for id in ids {
            match self
                .client
                .unregister_capability(vec![unregistration(&id)])
                .now_or_never()
            {
                Some(Ok(())) => tracing::debug!("retired configuration watch {id} during shutdown"),
                _ => tracing::debug!(
                    "configuration watch {id} retirement unacknowledged; disposing transport handle"
                ),
            }
        }
    }
}

fn wait_rpc<F>(
    cancelled: &mut oneshot::Receiver<()>,
    request: F,
) -> Option<tower_lsp::jsonrpc::Result<()>>
where
    F: Future<Output = tower_lsp::jsonrpc::Result<()>>,
{
    crate::runtime::block_on(async {
        match select(cancelled, Box::pin(request)).await {
            Either::Left(_) => None,
            Either::Right((result, _)) => Some(result),
        }
    })
}

fn unregistration(id: &str) -> Unregistration {
    Unregistration {
        id: id.into(),
        method: METHOD.into(),
    }
}

fn watchers(paths: &[PathBuf]) -> Option<Vec<FileSystemWatcher>> {
    paths
        .iter()
        .map(|path| {
            let parent = path.parent()?;
            let filename = path.file_name()?.to_str()?;
            let base_uri = Url::from_directory_path(parent).ok()?;
            let mut pattern = String::new();
            for character in filename.chars() {
                match character {
                    '[' => pattern.push_str("[[]"),
                    ']' => pattern.push_str("[]]"),
                    '{' => pattern.push_str("[{]"),
                    '}' => pattern.push_str("[}]"),
                    '?' => pattern.push_str("[?]"),
                    '*' => pattern.push_str("[*]"),
                    _ => pattern.push(character),
                }
            }
            Some(FileSystemWatcher {
                glob_pattern: GlobPattern::Relative(RelativePattern {
                    base_uri: OneOf::Right(base_uri),
                    pattern: pattern.into(),
                }),
                kind: Some(WatchKind::Create | WatchKind::Change | WatchKind::Delete),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "config_watchers_tests.rs"]
mod tests;
