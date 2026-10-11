# Reuse project-local native navigation owners

Issue: [#8371](https://github.com/ubugeeei-prod/vize/issues/8371).

Document dispatch keeps one `Arc<NativeNavigationProject>` for each current
initialized `ProjectContext`, alongside that context's `Arc<ServerState>`.
The foreground server also shares its primary navigation Arc with primary
request views. Repeated requests retain the same actual original Program,
selected SFC, and Names worker families rather than constructing a new cache.

The root registry owns each context. A cached navigation owner retains its
exact child state; that child retains only a `Weak` reference to the root.
Navigation never lives inside `ServerState`, avoiding a strong ownership cycle.
Lookup uses the child's existing boundary and verifies the initialized state
with `Arc::ptr_eq`; it does not scan other owners. A stale routed view cannot
initialize navigation in a replacement context. Native requests refuse that
view with the existing `Superseded` / `ContentModified` mapping, while ordinary
document dispatch may resolve the fresh context.

Retirement first marks the context and retained query registry atomically.
Issued snapshots, new worker admission, and prepared response publication then
refuse the old owner, including primary configuration changes. The existing
watcher subsequently aborts active work and removes all three worker families
outside context and worker-map locks. An in-flight Arc may drain without
keeping the root alive. Readiness still does not create a document generation;
no provider stage, serialization, or legacy substitute is added.

Regression tests use the real document dispatch, unchanged full UTF-16 native
answers, worker identities and production counts, primary and sibling owners,
configuration replacement, queued worker cancellation, all-family retirement,
and weak-root / final-child destruction. Native execution and the complete
original source qualification remain required on Actions; local formatting
and the 350-line source gate do not substitute for those gates.
