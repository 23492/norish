## 1. Permission Policy Extension

- [ ] 1.1 Add `rss-view` action to `RecipePermissionPolicySchema` in `server/db/zodSchemas/server-config.ts` with default `household`
- [ ] 1.2 Update `DEFAULT_RECIPE_PERMISSION_POLICY` to include `rss-view: "household"`
- [ ] 1.3 Update `canAccessResource` in `server/auth/permissions.ts` to handle the `rss-view` action
- [ ] 1.4 Update admin `permissions.ts` tRPC mutation to accept the extended schema
- [ ] 1.5 Add `rss-view` `<Select>` dropdown to `permission-policy-card.tsx` in admin settings
- [ ] 1.6 Add translation keys for the `rss-view` dropdown label and description

## 2. Database & Repository

- [ ] 2.1 Create `rss_feeds` table schema in `server/db/schema/` (`id`, `user_id`, `url`, `title`, `created_at`)
- [ ] 2.2 Create feed repository in `server/db/repositories/` with CRUD operations (list by user, list by visibility via `rss-view` policy, add, remove)
- [ ] 2.3 Write repository unit tests

## 3. Server: RSS Fetching & Parsing

- [ ] 3.1 Add `rss-parser` (or equivalent) dependency
- [ ] 3.2 Create RSS fetch/parse utility in `server/` that fetches a URL, parses RSS XML, and returns structured feed item DTOs
- [ ] 3.3 Handle parallel fetching of multiple feeds with per-feed error isolation
- [ ] 3.4 Limit to 50 most recent items per feed
- [ ] 3.5 Write unit tests for RSS parsing (valid RSS, malformed RSS, missing fields)

## 4. Server: tRPC Router

- [ ] 4.1 Create `feed` tRPC router in `server/trpc/routers/feed/`
- [ ] 4.2 Add `feed.list` query for current user's subscriptions
- [ ] 4.3 Add `feed.add` mutation to add feed URL to current user's subscriptions
- [ ] 4.4 Add `feed.remove` mutation to remove a feed subscription owned by current user
- [ ] 4.5 Add `feed.fetch` query that resolves visible feeds via `rss-view` policy and returns merged items
- [ ] 4.6 Merge feed router into app router
- [ ] 4.7 Write router integration tests

## 5. Frontend: Dashboard View Switching

- [ ] 5.1 Create title dropdown component (Instagram-style: title + caret, options `Your Recipes` / `Your Feed`)
- [ ] 5.2 Integrate dropdown into `app/(app)/page.tsx`, replacing static title
- [ ] 5.3 Manage view state via query param (`?view=feed`)
- [ ] 5.4 Conditionally render recipe grid or feed view based on active selection

## 6. Frontend: Feed View

- [ ] 6.1 Create `FeedView` component that fetches feed items via tRPC and renders merged list
- [ ] 6.2 Create `FeedItemCard` component (`title`, source, date, summary, image, import action)
- [ ] 6.3 Virtualize feed item list (reuse `useWindowVirtualizer` pattern)
- [ ] 6.4 Add loading skeleton
- [ ] 6.5 Add empty state when no visible subscriptions
- [ ] 6.6 Add partial failure UI for feeds that fail to parse/fetch
- [ ] 6.7 Wire `Import` action to existing recipe URL import mutation

## 7. Frontend: Feed Management Panel

- [ ] 7.1 Create `FeedManagementPanel` in `components/Panel/consumers/` using existing Panel pattern
- [ ] 7.2 Display current user's subscriptions with remove actions
- [ ] 7.3 Add URL input with validation for new feed URLs
- [ ] 7.4 Add feed-view cogwheel icon that opens panel
- [ ] 7.5 Wire panel add/remove actions to feed tRPC mutations

## 8. Internationalization

- [ ] 8.1 Add translation keys for feed UI (dropdown options, panel labels, empty/error states, import action)

## 9. Verification

- [ ] 9.1 Run tests (`pnpm test:run`)
- [ ] 9.2 Run build (`pnpm build`)
- [ ] 9.3 Run lint and format checks (`pnpm lint && pnpm format:check`)
- [ ] 9.4 Manual smoke test: set `rss-view` policy in admin, add feeds, switch views, import from feed
