## Context

Norish is a household recipe app. The dashboard currently shows only the user's own recipes. Users want to discover recipes from external blogs via RSS feeds. Feed subscriptions are owned by individual users (user-scoped storage). The existing permission system controls whether feeds are visible to other users. Feed items are browsed on-demand and can be imported into Norish using the existing recipe URL import pipeline.

## Goals / Non-Goals

- Goals:
  - Allow users to subscribe to multiple RSS feed URLs (user-scoped ownership)
  - Display a merged, chronologically-sorted feed view on the dashboard
  - Enable importing recipes from feed items via the existing URL import pipeline
  - Provide an in-page panel for managing feed subscriptions (add/remove)
  - Reuse the existing admin permission system with an added `rss-view` action

- Non-Goals:
  - Background polling or caching of feed content in the database (on-demand only)
  - Full-text feed item search or filtering
  - Feed item bookmarking or read/unread tracking
  - Atom feed support (RSS only for v1)

## Decisions

- **On-demand fetching:** RSS feeds are fetched server-side when the user switches to the feed view. No background jobs or persistent feed item storage.
  - Alternatives considered: BullMQ background polling + DB cache. Rejected for v1 due added complexity.

- **Server-side fetch and parse:** The server fetches and parses RSS XML to avoid CORS issues and sanitize output before sending to the client.
  - Alternatives considered: client-side fetch via proxy. Rejected for security/operational complexity.

- **Dashboard view switching:** Use an Instagram-style title dropdown (`Your Recipes` / `Your Feed`) with query param persistence (`?view=feed`).

- **Feed management panel:** Use the existing Panel pattern with a cogwheel action in feed view, matching groceries UX.

- **Import action:** Each feed item card includes `Import`, reusing the existing recipe import pipeline with the feed item's URL.

- **DB schema:** Add `rss_feeds` with columns `id`, `user_id`, `url`, `title`, `created_at`.
  - Alternatives considered: `household_id` ownership. Rejected because it conflicts with policy changes to owner/user scope.

- **Permissions:** Feed visibility uses the same permission policy system as recipes (`RecipePermissionPolicySchema` in `server/db/zodSchemas/server-config.ts`, checked via `canAccessResource` in `server/auth/permissions.ts`). Add `rss-view` action with levels `everyone`/`household`/`owner`, default `household`. Admin configures this in a fourth dropdown in `permission-policy-card.tsx`. Users always manage their own feed subscriptions; `rss-view` controls read visibility of other users' feeds.

## Risks / Trade-offs

- **Fetch latency:** Multiple feeds on-demand can be slow. Mitigation: parallel fetch + React Query stale caching + loading skeleton.
- **Feed variability:** RSS quality differs widely. Mitigation: robust parser and per-feed error isolation.
- **High item volume:** Some feeds are large. Mitigation: cap to latest 50 items per feed and virtualize feed list.

## Open Questions

- Should Atom support be included in v1 or deferred?
- Should we extract preview images only from RSS-standard fields, or include additional HTML scraping fallback later?
