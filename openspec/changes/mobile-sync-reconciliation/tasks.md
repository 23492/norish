## 1. Aggregate sync status

- [ ] 1.1 Add aggregate sync-issue classification derived from terminal outbox outcomes.
- [ ] 1.2 Add a shell-level sync banner with coarse i18n messaging that stays separate from the reachability banner.

## 2. Reconciliation behavior

- [ ] 2.1 Wire targeted invalidation/refetch for conflict and gone outcomes so authoritative server state replaces stale optimistic state.
- [ ] 2.2 Update envelope-aware reconciliation paths to use `operationId` and `eventId` for dedupe and post-reconnect repair only.
- [ ] 2.3 Treat duplicate replay outcomes as resolved success and clear queued commands without per-item failure UI.

## 3. Verification

- [ ] 3.1 Add tests for delete conflict repair, edit-gone repair, duplicate replay, and websocket reconnect during replay.
- [ ] 3.2 Manually verify the app shows one aggregate sync failure banner and avoids noisy per-action error surfaces.
