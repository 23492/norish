# Phase 21 — Context & scoping audit

**Written:** 2026-07-21, against `main` @ `7109dade` (live image `c5fb0e897946`).
**Method:** every claim below was read out of the current tree or measured against live.
Where the ROADMAP's framing turned out to be wrong or incomplete, that is called out
explicitly rather than silently corrected.

The ROADMAP entry for this phase asserts five success criteria. This audit finds that
**they are not one phase.** Two are small and concrete, one is a re-architecture that was
mis-sized as polish, one is a product decision that cannot be planned without Kiran, and
one is blocked on evidence that does not exist yet. Splitting them is the main
recommendation.

---

## Strand A — MEDIA-UX-01

### A1. The lightbox drops non-image media. CONFIRMED, and it is a type problem, not a filter problem.

`apps/web/components/shared/media-carousel.tsx:196-203`:

```ts
const lightboxImages = useMemo(() => {
  return sortedItems
    .filter((item) => item.type === "image")
    .map((item) => ({ src: item.src, alt: `Recipe media ${item.id || ""}` }));
}, [sortedItems]);
```

and `openLightboxForItem` (line 215) hard-returns for anything else:

```ts
if (item.type !== "image") return;
```

So on a recipe with 1 photo + N videos, tapping the photo opens a lightbox of length 1 —
no counter, no arrows, no thumbnail strip, because `ImageLightbox` gates all three on
`showNavigation = images.length > 1` (`image-lightbox.tsx:49`).

**The ROADMAP frames this as "remove the filter". That is not sufficient.**
`ImageLightboxProps.images` is typed `{ src: string; alt?: string }[]` — there is no
discriminator — and the component renders every entry through `next/image`. Feeding it
videos would render `<Image>` over an `.mp4`. The real work is:

1. widen the prop to a discriminated media type (or introduce `MediaLightbox` alongside),
2. branch the slide renderer on `type` (reusing the existing `VideoPlayer` that
   `media-carousel.tsx` already imports),
3. branch `Carousel.Thumbnail`, which is `NextImage`-only (`components/ui/carousel.tsx:330`)
   and so cannot represent a video thumbnail at all today.

Item 3 is the hidden cost: `Carousel.Thumbnail` is a **local reimplementation of the
removed HeroUI Pro component**, authored in Phase 20.1 to preserve the pro API. Changing
its contract is in-scope for this repo (we own it now), but it is a shared UI primitive —
check other consumers before widening.

**Sizing:** ~1 plan, but a real one. Not a filter deletion.

### A2. Wasteful image fetches — the ROADMAP is RIGHT, and I was wrong to "correct" it mid-session.

For the record, because I stated the opposite to Kiran earlier today: the ROADMAP's
attribution to `components/ui/carousel.tsx` with `sizes="64px"` is **accurate** —
`carousel.tsx:330-335` is `<NextImage unoptimized ... sizes="64px" />`. My claim that it
was "actually in image-lightbox.tsx" was wrong. What is *additionally* true, and not in
the ROADMAP, is that `image-lightbox.tsx:182` and `:231` are also `unoptimized`.

The wider finding is that this is not a two-site bug. **`unoptimized` is on every recipe
media render in the app — 12 sites:**

| File | Lines |
|---|---|
| `components/shared/media-carousel.tsx` | 155, 289 |
| `components/shared/image-lightbox.tsx` | 182, 231 |
| `components/ui/carousel.tsx` | 332 |
| `components/shared/import-from-image-modal.tsx` | 231 |
| `components/recipes/readonly-steps-list.tsx` | 218 |
| `components/recipes/media-gallery-input.tsx` | 145, 171 |
| `components/recipes/image-gallery-input.tsx` | 110 |
| `app/(app)/recipes/[id]/components/cookingmode/step-images.tsx` | 45, 77 |

`apps/web/next.config.js` sets **no `images` config at all**, so Next's default optimizer
is available and same-origin paths would work. The bypass is app-wide and deliberate-
looking, which means there is probably a reason for it that predates the UAT — most likely
that media is served by auth-gated dynamic route handlers
(`app/(app)/recipes/[id]/[filename]/route.ts`), and the optimizer fetches server-side
without the caller's session cookie. **This must be established before any `unoptimized`
is removed**, or the fix will 401 every image in production.

**A note on the reported symptom.** Kiran reports "the same image fetched at several
sizes". With `unoptimized` set, Next emits no `srcset` and `sizes` is inert, so these
sites cannot themselves produce multiple sizes — they produce one full-size fetch of one
URL, which the browser should then cache. So the symptom is **not yet explained by the
code**, and the ROADMAP is right that a network trace is required. Do not "fix" this
before the trace: the trace may point somewhere else entirely, and removing `unoptimized`
is the change most likely to break production if the auth theory is correct.

**Sizing:** trace first (no code), then 1 plan. Gate the plan on the trace.

---

## Strand B — chrome reduction

### B1. Settings reduction — NOT PLANNABLE without a decision from Kiran.

Four tabs: `user`, `household`, `caldav`, `admin` (`app/(app)/settings/`). The
self-hostable feel comes almost entirely from **admin**, which carries 20 components
including `json-editor`, `prompts-form`, `timer-keywords-editor`, `ai-config-form`,
`auth-providers/*`, `content-detection-card`, `video-processing-form`,
`bulk-categorization-form`, and `system-card` with a restart-confirmation modal.

**The blocker is not effort, it is authority.** "Only what a normal user needs" does not
determine whether a given card is cut, hidden behind a role, or moved to env-only config —
and Phases 14 (`operator-config-env`) and 15 (`single-admin-env`) already moved some
operator config to env. Cutting a card that is the **only** way to set something would be
a functional regression dressed as polish, and Kiran's "if we miss any, we can bring them
back" does not cover settings that become unreachable.

**Recommendation:** produce a card-by-card inventory with a proposed disposition
(keep / hide behind admin role / env-only / delete) and put it to Kiran as a single
decision. Do not write plans first.

### B2. Mobile-nav avatar — small, but must not undo Phase 13.

`components/navbar/mobile-nav.tsx:119-127` renders `NavbarUserMenu` in a `h-13` pill.
The comment there records a deliberate earlier decision:

> Avatar only on mobile — the name/cookbook label is intentionally hidden here; the full
> name lives inside the menu it opens.

That is **Phase 13 (`13-mobile-nav-hide-name`)**. The UAT complaint is about the avatar
element looking wonky, *not* about the hidden name — so the fix is to the avatar's own
rendering, and re-introducing the name would revert a shipped phase. Flagging because
"replace the avatar with a clean, consistent element" reads like license to redesign the
whole control.

**Sizing:** small, ~half a plan. Needs a screenshot to know what "wonky" means.

### B3. Calendar rows-of-7 — MIS-SIZED. This is a re-architecture, not polish.

The calendar is not a month grid that needs restyling. It is a **timeline**:
`app/(app)/calendar/page.tsx:109` picks `DesktopTimeline` or `MobileTimeline`, backed by
9 mobile components (`timeline-day-section`, `timeline-slot-container`,
`timeline-planned-item`, drag overlays…) and 5 desktop ones, plus drag-and-drop with its
own integration test (`__tests__/integration/calendar-dnd.test.tsx`).

"Tappable rows of 7 that expand into a single day" is a **month/week grid** — a different
information architecture, with its own drag-and-drop story to redesign. Putting it in a
polish phase alongside an avatar tweak will either blow the phase or produce a half-built
grid.

**Recommendation:** split into its own phase, and treat "hide empty past days" (which *is*
a cheap filter on the existing timeline) as the polish-phase-sized piece.

---

## Out-of-scope finding — MEDIA-AUTHZ-01 (defence-in-depth gap, filed not fixed)

Found while establishing why `unoptimized` is set everywhere. **Recipe media is served
with authentication but no authorization.**

- `app/(app)/recipes/[id]/[filename]/route.ts` validates that `id` is UUID-shaped and
  calls `serveRecipeMedia`. Grep for `canAccess|getSession|household|auth` in that file
  and in the `steps/[filename]` sibling: **0 hits in both.**
- `lib/recipe-media.ts:127` does filename validation and path-traversal-safe resolution,
  then streams the file. No ownership or cookbook check.
- The only gate is `apps/web/proxy.ts`, whose matcher does cover these paths, but which
  checks **`session?.user` only** — i.e. *any* logged-in user, not *this* user.
- Verified against live: unauthenticated fetch of a real recipe's media returns `307` to
  `/login?callbackUrl=…`, so the proxy gate is real and working. The gap is what happens
  *after* login.

So an authenticated member of cookbook A can fetch cookbook B's media given both UUIDs.

**Why this is filed rather than escalated:** it requires knowing *both* the recipe id and
the media filename, and the two leaks fixed today do not hand over the pair.
`RecipeDashboardSchema` (`packages/shared/src/contracts/zod/recipe.ts:44`) omits media —
only `FullRecipeSchema` carries `images`/`videos`. So the dashboard DTO that Phase 22
broadcast, and that Phase 22.2's unfiltered list returned, exposed recipe **ids but not
filenames**. Filenames are UUIDs and not enumerable.

That makes this a real IDOR but not a currently-exploitable one — which is exactly the
kind of finding that should be written down and sequenced rather than either ignored or
panic-fixed. It is the **fourth** member of the family Phase 22 / 22.1 / 22.2 belong to,
and per the `AGENTS.md` rule added today it wants a test that seeds the live policy.

**Recommendation:** own phase or a 22.3, sized ~1 plan (`canAccessResource` on both media
routes + a two-cookbook test). Not part of Phase 21.

---

## Recommended re-sequencing

| Work | Where it should go | Blocked on |
|---|---|---|
| A1 lightbox media-awareness | **Phase 21** | nothing — ready to plan |
| B2 mobile-nav avatar | **Phase 21** | a screenshot of "wonky" |
| "hide empty past days" | **Phase 21** | nothing |
| A2 `unoptimized` / image sizing | **Phase 21, gated** | network trace + why the bypass exists |
| B1 settings reduction | **decision first, then a phase** | Kiran's card-by-card call |
| B3 calendar rows-of-7 | **own phase** | its own design pass (drag-and-drop) |
| MEDIA-AUTHZ-01 | **22.3 or own phase** | nothing — ready to plan |

**Suggested Phase 21 as actually plannable today:** A1 + B2 + empty-past-days, with A2
added once the trace lands. That is a coherent 2–3 plan phase. The rest needs either a
decision or a design.
