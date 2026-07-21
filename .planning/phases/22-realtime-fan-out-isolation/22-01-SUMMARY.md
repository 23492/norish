# 22-01 SUMMARY — Audit + adversarial harness

**Commit**: `de3bf9a4` `test(22-01): failing two-household realtime fan-out isolation harness`
**Production diff**: none (`git diff --name-only main -- packages/*/src` empty)

## What landed

- `.planning/phases/22-realtime-fan-out-isolation/22-AUDIT.md` — all 54 `emitByPolicy`
  sites, with event, payload shape, policy source and target key per site.
- `packages/shared-server/__tests__/realtime/fan-out-harness.ts` — `RecordingEmitter`
  (publish side, channel names derived from a real `TypedRedisEmitter`) +
  `subscriberChannels` (receive side, mirroring `createPolicyAwareIterables`' household /
  broadcast / user triple) + `deliveredTo` / `broadcastChannels` + two-cookbook fixtures.
- `packages/shared-server/__tests__/realtime/fan-out-isolation.test.ts` — 12 failing tests.

## Result: RED, as required

```
 FAIL  ... event: imported > is never delivered to a member of another cookbook
 AssertionError: expected [ 'norish:recipe:broadcast:imported' ] to deeply equal []
 Test Files  1 failed | 13 passed (14)
      Tests  12 failed | 182 passed (194)
```

## Deviation from the plan: the ROADMAP's "34 of 54" was wrong

The plan and ROADMAP both carried "**34** of 54 resolve their policy from the server-wide
`getRecipePermissionPolicy()`". The full re-audit found it is **54 of 54** — there was no
emit site anywhere that consulted the recipe's own cookbook.

The audit also surfaced a **second, independent leak vector the phase brief did not name**:
every site passes `ctx.householdKey`, which `packages/trpc/src/middleware.ts:38` sets to
the **actor's** active cookbook (`household?.id ?? user.id`). Closing the broadcast branch
alone would still misroute events on the cross-cookbook flows (`saveShared`, rating a
recipe shared from another cookbook). This is why 22-02's resolver returns the target key
as well as the policy, rather than just the policy as the plan originally described.

## Self-check

- Test executed and observed RED; output recorded above and in 22-VALIDATION.md §1. ✓
- The "user A still receives it" assertion is present, so 22-02 cannot pass by deleting
  emissions. ✓
- Zero production diff. ✓
