## 1. Storage and reachability foundation

- [ ] 1.1 Add a dedicated durable mobile outbox store with explicit schema/versioning and startup hydration.
- [ ] 1.2 Align replay gating with backend HTTP reachability so replay is not blocked solely by websocket disconnects.

## 2. Core outbox behavior

- [ ] 2.1 Implement the semantic outbox item model, replay state machine, and serializer for persisted commands.
- [ ] 2.2 Implement safe same-entity compaction rules for edit, desired-state, and delete command families.
- [ ] 2.3 Implement a sequential replay executor that preserves stored `operationId` and resolves commands from direct mutation responses.

## 3. Failure handling and tests

- [ ] 3.1 Classify retryable versus terminal replay outcomes so the queue does not retry terminal conflicts forever.
- [ ] 3.2 Add mobile tests for restart hydration, sequential replay, websocket disconnect during replay, and retryable replay failures.
