## ADDED Requirements

### Requirement: Feed Subscription Management

The system SHALL allow users to manage their own RSS feed subscriptions. Feed URLs SHALL be stored per-user (user-scoped ownership). Any user SHALL be able to add and remove their own feed subscriptions. Visibility of feeds to other users SHALL be controlled by a new `rss-view` action in the existing permission policy (same system as recipe view/edit/delete), configurable by the server admin with the same three levels: `everyone`, `household` (default), and `owner`.

#### Scenario: Add a feed subscription

- **WHEN** a user enters a valid RSS feed URL in the feed management panel and confirms
- **THEN** the feed URL is saved to the user's feed subscriptions
- **AND** the feed appears in the subscription list

#### Scenario: Remove a feed subscription

- **WHEN** a user removes one of their own feed subscriptions from the management panel
- **THEN** the feed URL is deleted from the user's subscriptions
- **AND** the feed no longer appears in the feed view

#### Scenario: Feed visibility with rss-view set to everyone

- **WHEN** the `rss-view` permission policy is set to `everyone`
- **THEN** the feed view merges feed subscriptions from all users on the server

#### Scenario: Feed visibility with rss-view set to household

- **WHEN** the `rss-view` permission policy is set to `household`
- **THEN** the feed view merges feed subscriptions from all household members

#### Scenario: Feed visibility with rss-view set to owner

- **WHEN** the `rss-view` permission policy is set to `owner`
- **THEN** the feed view shows only the current user's own subscriptions

### Requirement: Dashboard View Switching

The system SHALL provide an Instagram-style dropdown selector on the dashboard page title. The dropdown SHALL allow the user to switch between `Your Recipes` (default) and `Your Feed` views. The selected view SHALL be reflected in the URL query parameter (`?view=feed`) so it persists across page refreshes.

#### Scenario: Switch to feed view

- **WHEN** the user clicks the dashboard title dropdown and selects `Your Feed`
- **THEN** the recipe grid is replaced with the feed item list
- **AND** the URL updates to include `?view=feed`
- **AND** the feed management cogwheel icon becomes visible

#### Scenario: Switch back to recipes view

- **WHEN** the user clicks the dashboard title dropdown and selects `Your Recipes`
- **THEN** the feed item list is replaced with the recipe grid
- **AND** the `?view=feed` query parameter is removed from the URL

#### Scenario: Direct navigation to feed view

- **WHEN** a user navigates to the dashboard URL with `?view=feed`
- **THEN** the feed view is displayed directly

### Requirement: On-Demand Feed Fetching

The system SHALL fetch RSS feed content on-demand when the user switches to the feed view. Feed data SHALL be fetched server-side to avoid CORS issues. The server SHALL parse the RSS XML and return structured feed item data to the client. The set of feeds fetched SHALL be determined by the `rss-view` permission policy level: `everyone` fetches all users' feeds, `household` fetches household members' feeds, `owner` fetches only the requesting user's feeds. Multiple feed subscriptions SHALL be fetched in parallel and their items merged chronologically (newest first). Results SHALL be cached on the client with a short stale time.

#### Scenario: Fetch feeds on view switch

- **WHEN** the user switches to the feed view and there are visible feed subscriptions (per the `rss-view` policy)
- **THEN** the system fetches all visible subscribed feeds in parallel on the server
- **AND** returns a merged, chronologically-sorted list of feed items
- **AND** displays them with a loading skeleton during fetch

#### Scenario: No feed subscriptions

- **WHEN** the user switches to the feed view and there are no visible feed subscriptions
- **THEN** the system displays an empty state prompting the user to add feeds

#### Scenario: Feed fetch failure

- **WHEN** one or more feed URLs fail to fetch or parse
- **THEN** the system displays items from the feeds that succeeded
- **AND** shows an error indicator for the failed feeds

### Requirement: Feed Item Display

The system SHALL display feed items as cards showing the item title, source feed name, publication date, a summary or description, and an image if available (from RSS `enclosure` or `media:content` elements). Each card SHALL link to the original article URL. The feed item list SHALL be virtualized for performance when displaying many items. The system SHALL limit display to the most recent 50 items per feed.

#### Scenario: Feed item with image

- **WHEN** a feed item includes an image via enclosure or media content
- **THEN** the feed card displays that image

#### Scenario: Feed item without image

- **WHEN** a feed item does not include an image
- **THEN** the feed card displays a placeholder or text-only layout

### Requirement: Import Recipe from Feed

The system SHALL allow users to import a recipe from a feed item into their Norish collection. Each feed item card SHALL display an `Import` action. Triggering import SHALL submit the feed item's link URL to the existing recipe URL import pipeline.

#### Scenario: Import a recipe from feed item

- **WHEN** the user clicks `Import` on a feed item card
- **THEN** the system submits the feed item's URL to the recipe import pipeline
- **AND** the user receives feedback that the import has been queued

### Requirement: Feed Management Panel

The system SHALL provide a cogwheel icon on the dashboard when the feed view is active. Clicking the cogwheel SHALL open a Panel (bottom-sheet style, matching the existing Panel pattern) where the user can view, add, and remove feed subscriptions. The panel SHALL validate that entered URLs are well-formed before saving.

#### Scenario: Open feed management panel

- **WHEN** the user clicks the cogwheel icon in the feed view
- **THEN** the feed management panel opens as a bottom-sheet overlay
- **AND** displays the list of current feed subscriptions with remove buttons
- **AND** provides an input field to add new feed URLs

#### Scenario: Add invalid feed URL

- **WHEN** the user enters a malformed URL in the feed management panel
- **THEN** the system displays a validation error and does not save the URL

### Requirement: RSS Feed Permission Policy Configuration

The system SHALL extend the existing `RecipePermissionPolicySchema` with a new `rss-view` action alongside the existing `view`, `edit`, and `delete` actions. The `rss-view` action SHALL use the same three permission levels (`everyone`, `household`, `owner`) and SHALL default to `household`. The admin settings UI SHALL display a fourth `<Select>` dropdown for `rss-view` in the `PermissionPolicyCard` alongside the existing recipe permission dropdowns. Server admins SHALL be able to change the `rss-view` level independently of the recipe permission levels.

#### Scenario: Admin configures rss-view policy

- **WHEN** a server admin changes the `rss-view` dropdown in the permission policy card
- **THEN** the `rss-view` policy level is persisted to `server_config`
- **AND** subsequent feed fetch queries use the updated policy level

#### Scenario: Default rss-view policy

- **WHEN** no `rss-view` policy has been explicitly configured
- **THEN** the system defaults to `household` for the `rss-view` action
