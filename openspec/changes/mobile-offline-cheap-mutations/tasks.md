## 1. Supported mutation allowlist

- [ ] 1.1 Define the first-wave supported cheap mobile mutation families and route their hooks through the durable outbox instead of the offline block path.
- [ ] 1.2 Capture `expectedVersion` or desired-state metadata from current query snapshots when those supported commands are enqueued.

## 2. Optimistic UI integration

- [ ] 2.1 Apply immediate optimistic cache updates for supported delete and edit flows while preserving latest local intent.
- [ ] 2.2 Apply desired-state optimistic behavior for supported set/toggle-like actions without reintroducing implicit toggle replay.
- [ ] 2.3 Keep imports, uploads, temp-ID create flows, and other unsupported actions on the existing live-only guard path.

## 3. Verification

- [ ] 3.1 Add hook-level tests for offline enqueue, delete replay success, and multiple queued edits collapsing to the latest local intent.
- [ ] 3.2 Manually verify active mobile recipe surfaces remain responsive offline and reconcile cleanly after replay.
