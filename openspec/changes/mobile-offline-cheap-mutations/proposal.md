## Why

An outbox core is only infrastructure until real mutation flows adopt it. The mobile app still assumes live server success for most edits and deletes, so users get blocked instead of the immediate local-first experience needed in kitchens and low-connectivity environments.

## What Changes

- Enable offline-capable optimistic enqueue for cheap mobile mutations such as delete, edit, and desired-state set/toggle flows.
- Apply immediate optimistic cache updates on enqueue and keep replay-safe coalescing for multiple local edits to the same entity.
- Adopt the new replay-safe server contracts from the versioned-mutation phase in the first supported mobile mutation families.
- Keep create flows that need temp IDs, imports, uploads, and other long-running work out of scope for this phase.
- Preserve a balanced local-first UX by favoring coarse repair via invalidation/refetch over detailed per-action error handling.

## Capabilities

### New Capabilities
- `mobile-offline-cheap-mutations`: Immediate optimistic UI and offline enqueue behavior for replay-safe mobile edit/delete/set actions.

### Modified Capabilities
None.

## Impact

- `apps/mobile` mutation call sites and screens that currently assume live success
- `packages/shared-react` mutation hooks and optimistic cache helpers shared by mobile surfaces
- Initial supported mutation domains for the offline-write rollout, while excluding imports/uploads and temp-ID creates
