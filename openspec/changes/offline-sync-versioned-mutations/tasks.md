## 1. Versioned mutation contracts

- [ ] 1.1 Inventory the first replay-safe mutation families and map each one to either a versioned entity contract or a desired-state idempotent contract.
- [ ] 1.2 Add `version` columns, migrations, and read-contract exposure for the selected versioned entity families.
- [ ] 1.3 Add shared input/output schema types for `expectedVersion` and structured replay outcomes.

## 2. Server-side replay safety

- [ ] 2.1 Update repositories and services to perform compare-and-swap edit/delete behavior and increment versions on successful writes.
- [ ] 2.2 Replace replay-unsafe toggle handlers in the first-wave families with desired-state or set-style handlers.
- [ ] 2.3 Add operation receipt persistence keyed by `operationId` with collision validation for mismatched semantics.

## 3. Router integration and verification

- [ ] 3.1 Update tRPC procedures for the replay-safe mutation families to return structured `applied` / `duplicate` / `conflict` / `gone` outcomes.
- [ ] 3.2 Add regression tests for stale version, missing entity, duplicate replay, and desired-state duplicate safety.
