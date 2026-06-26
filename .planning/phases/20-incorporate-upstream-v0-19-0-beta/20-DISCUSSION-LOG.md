# Phase 20: Incorporate upstream v0.19.0-beta - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 20-incorporate-upstream-v0-19-0-beta
**Areas discussed:** Merge vs rebase, db-schema split, Feature keep/drop
**Area offered but not selected:** Cutover sequencing (roadmap already fixes live cutover as a separate step; later resolved via the norish-beta decision)

---

## Merge vs rebase

### Strategy
| Option | Description | Selected |
|--------|-------------|----------|
| git merge | Branch off main, `git merge upstream/main`; one conflict pass against the squash; preserves 156-commit history; re-runnable | ✓ |
| git rebase onto upstream | Replay 156 commits onto upstream; linear but 156× conflict re-resolution | |
| Squash-merge our work | Collapse fork to one diff then merge; loses per-phase granularity | |

**User's choice:** git merge

### Branch base & safety net
| Option | Description | Selected |
|--------|-------------|----------|
| Branch off main + tag main | `integ/upstream-0.19.0` off main + tag `pre-0.19.0-integration` first | ✓ |
| Branch off main, no tag | main is already a stable ref; skip extra tag | |

**User's choice:** Branch off main + tag main

### Resolution staging
| Option | Description | Selected |
|--------|-------------|----------|
| One merge, grouped resolution plans | Single merge, then resolve by subsystem in dependency order, each a gated gsd plan | ✓ |
| One giant resolution pass | Resolve all ~110 conflicts in one plan/commit | |

**User's choice:** One merge, grouped resolution plans

---

## db-schema split

### Adopt the split?
| Option | Description | Selected |
|--------|-------------|----------|
| Adopt the split | Re-port our table defs into `@norish/db-schema`; `packages/db/src/schema/*` become upstream shims | ✓ |
| Keep flat packages/db/src/schema | Decline the reorg; fights upstream structure, breaks imports | |

**User's choice:** Adopt the split

### Reconciliation method
| Option | Description | Selected |
|--------|-------------|----------|
| Per-table 3-way re-apply | Upstream 0.19.0 db-schema file as base; re-apply only our fork's additions on top | ✓ |
| Wholesale-replace with our versions | Overwrite upstream table files with ours; risks dropping 0.19.0 changes | |

**User's choice:** Per-table 3-way re-apply

**Notes:** Grounding during discussion established that upstream 0.19.0's `packages/db/src/schema/*` are one-line re-export shims of the new `@norish/db-schema` package; migrations top out at 0034 with NO collision against our 0035–0038; the split is code-only (no new SQL migrations). This made "adopt" near-forced and de-risked the area.

---

## Feature keep/drop

### Triage stance
| Option | Description | Selected |
|--------|-------------|----------|
| Take-all, re-assert constraints | Accept all 0.19.0 changes by default; override only at fork hard-constraint collisions | ✓ |
| Selective cherry-pick of features | Deliberately exclude some 0.19.0 features as churn | |

**User's choice:** Take-all, re-assert constraints

### Conflict bias (non-constraint files)
| Option | Description | Selected |
|--------|-------------|----------|
| Favor upstream | Take upstream's version for non-constraint files; our code wins only in constraint/feature files | ✓ |
| Favor ours | Default to keeping the fork's version on conflict | |

**User's choice:** Favor upstream

### Timing (beta now vs wait for stable)
| Option | Description | Selected |
|--------|-------------|----------|
| Integrate beta now on the branch | Integrate + resolve + green gates now, off the live stack | ✓ (extended) |
| Wait for stable 0.19.0 | Hold the phase until upstream promotes out of beta | |

**User's choice (free-text):** "Integrate beta now, and publish as a norish-beta.knoppsmart.com."

**Notes / follow-up (plain-text):** User extended the timing decision into a deployment directive. Confirmed: `norish-beta.knoppsmart.com` is a NEW public beta environment, in scope for Phase 20 (final plan(s)), validating 0.19.0 without touching live. It runs a **duplicate testing DB cloned from live**, kept **refreshed** (re-clone from live whenever practical — explicitly "no old db in the future"; treat beta-DB staleness as a defect). Live `norish.knoppsmart.com` stays on the phases-1–19 image; cutover of 0.19.0 to live remains a separate future decision.

---

## Claude's Discretion

- Subsystem plan count / split granularity within the D-03 dependency order (planner decides; one plan at a time per `use_worktrees: false`).
- Beta provisioning mechanics (compose service name, Cloudflare tunnel/ingress wiring, DB restore scripting) within D-11/D-12 constraints.

## Deferred Ideas

- Cutover of 0.19.0 to live `norish.knoppsmart.com` — separate deliberate step after beta validation.
- Other upstream branches (`feature/add-site-auth-tokens`, `Offline-mode`, `rc/0.17.3-beta`, `feature/rss-feed`) — each its own future phase.
- Promotion of beta → stable once upstream tags a non-beta 0.19.0.
