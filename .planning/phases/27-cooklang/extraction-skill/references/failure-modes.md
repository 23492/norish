# Failure modes & the confidence gate

Distilled from `27-EXPERIMENT.md` and sharpened by running the prompt against live
DeepSeek (`deepseek-v4-pro`). Ordered by how much they hurt real output.

## Prompt-adherence failures (found against LIVE DeepSeek — the ones that actually broke)

These did NOT show up when a careful model (Claude) played the stand-in; they only
appeared with live DeepSeek, which is exactly why the harness runs `--live`.

1. **Name = whole list line.** DeepSeek used `"100g plain flour"` /
   `"oil or melted butter, for frying"` as the ingredient `name`. Those strings are
   not in the step prose, so nothing anchors and every token is appended at the end.
   → Fragment rule A: name is the short core word AS IT APPEARS IN THE STEP TEXT.
2. **Cumulative carry-forward.** DeepSeek listed every ingredient used so far in each
   later step (the final "serve" step relisted all 11 ingredients). → Fragment rule
   B: a step lists only what its own sentence names; never carry forward.

## Linkage-judgement failure modes (from the experiment, ranked)

3. **Amount split across steps (irreducible MISS).** e.g. 400 ml coconut milk used
   "a little" then "the rest"; the source never quantifies the split. Best effort:
   full amount on the main use, bare ref on the other. **Detectable** and flagged
   low-confidence; not hidden.
4. **Ingredient named in >1 step (ambiguous).** onion/garlic chopped then fried.
   Convention "amount on first add, name-only after" resolves it deterministically.
   **Detectable:** name appears in ≥2 steps.
5. **Substring / name collision.** "sugar" ⊂ "brown sugar"; "tomato" ⊂ "chopped
   tomato"; list "lime" vs prose "lime juice". The serializer's **longest-name-first**
   matching fixes all three — this is mandatory, not a nicety.
6. **"To taste" / no amount (handled).** salt / "a pinch" / oil "for frying" →
   `amount: null, unit: null` → a clean bare `@salt` token. Not a failure if the UI
   renders a bare chip.
7. **Unnamed garnish (handled if named).** Parmesan/herbs anchor inline when the
   serve step names them; if the step said only "serve", the ref falls to the
   serializer's `appended` bucket. **Detectable:** `placement === "appended"`.

## Confidence gate (D-7) — all cheap + deterministic

A `.cook` is **trusted** only if ALL hold, else it is **low** → repair queue:

- **0 `appended` links** — every ref anchored in the prose (from the serialize report).
- **No ingredient declares a non-null amount in >1 step** — catches double counting.
- **Every listed ingredient is referenced by ≥1 step** — no orphans.
- **No known split-amount ingredient** (Σ per-step amounts ≠ structured total).

The harness (`e2e-harness/src/evaluate.ts`) computes exactly these and prints the
bucket + the reasons. Low-confidence recipes still get their best-effort `.cook`
stored; they just are not trusted for the parser-token renderer until repaired.
