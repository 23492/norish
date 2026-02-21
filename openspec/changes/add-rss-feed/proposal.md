# Change: Add RSS Feed View to Dashboard

## Why

Users want to discover new recipes from external blogs and cooking sites without leaving Norish. Currently the dashboard only shows the user's own recipe collection, with no way to browse external recipe content. An RSS feed view lets users subscribe to recipe blogs and import discoveries directly into their collection.

## What Changes

- Add a new `rss_feeds` database table to store feed URLs per user (user-scoped ownership)
- Add a new `rss_feed` tRPC router with CRUD for feed subscriptions and on-demand feed fetching/parsing
- Replace the static "Your Recipes" page title with an Instagram-style dropdown selector (caret icon) to switch between "Your Recipes" and "Your Feed" views
- Add a feed item list component that displays RSS entries (title, image, summary, source) in the dashboard area when the feed view is active
- Add an "Import" action on feed items that triggers the existing recipe URL import pipeline
- Add a cogwheel icon (visible in feed view) that opens a Panel for managing feed subscriptions (add/remove feed URLs)
- Feed data is fetched on-demand when the user switches to the feed view, with short-lived client-side caching
- Extend the existing `RecipePermissionPolicySchema` with a new `rss-view` action (same `everyone`/`household`/`owner` levels) to control feed visibility scope
- Add a fourth `<Select>` dropdown for `rss-view` in the admin `PermissionPolicyCard` alongside the existing view/edit/delete dropdowns
- Feed fetching at runtime respects the `rss-view` policy level to determine which users' feeds are visible

## Impact

- Affected specs: New `rss-feed` capability
- Affected code:
  - `server/db/schema/` — new `rss_feeds` table
  - `server/db/repositories/` — new feed repository
  - `server/db/zodSchemas/server-config.ts` — extend `RecipePermissionPolicySchema` with `rss-view`
  - `server/auth/permissions.ts` — support `rss-view` action in `canAccessResource`
  - `server/trpc/routers/` — new `feed` router
  - `server/trpc/routers/admin/permissions.ts` — accept updated policy schema
  - `app/(app)/settings/admin/components/permission-policy-card.tsx` — add `rss-view` dropdown
  - `app/(app)/page.tsx` — dashboard view switching
  - `components/dashboard/` — new feed components and title dropdown
  - `components/Panel/consumers/` — new feed management panel
  - `context/` — new feed context or extension of recipes context
