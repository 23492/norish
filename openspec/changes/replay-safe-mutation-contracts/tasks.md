## 1. Inventory and shared contracts

- [ ] 1.1 Confirm the replay-unsafe mutation inventory and map each family to a desired-state or `expectedVersion` replacement contract.
- [ ] 1.2 Add shared input and output schema types for replay-safe mutations, including `applied`, `duplicate`, `conflict`, and `gone` outcomes.

## 2. Server replay safety

- [ ] 2.1 Add durable operation receipt persistence keyed by mutation family, actor scope, `operationId`, and semantic request fingerprint.
- [ ] 2.2 Update the targeted repositories and tRPC procedures to use replay-safe contract shapes and return structured outcomes.
- [ ] 2.3 Ensure duplicate replays reuse stored outcomes and do not re-run derived side effects such as recurring schedule advancement.

## 3. Caller migration and verification

- [ ] 3.1 Migrate shared React, web, and mobile callers plus optimistic cache logic to the new replay-safe contracts in one coordinated sweep.
- [ ] 3.2 Remove or reject legacy replay-unsafe entry points and add regression coverage for duplicate replay, stale state, missing state, and one-time side effects.
