# v0.18.0-beta

## Breaking changes

> [!WARNING]
> The previous health endpoint was removed. Integrations should use `/api/v1/health`.

## Summary

This release is mainly focused on public recipe sharing and the new recipe import pipeline built around the `recipe-scrapers` Python package.
It also includes local development improvements, expanded localization coverage, and a set of fixes across configuration, CI, release tooling, and UI behavior.

## Fixes and Improvements

### Public shareable recipes
Recipes can now be shared publicly. To do this, go to a recipe, click the three dots menu in the top right corner, and click the share button. You can then copy the link and share it with others. The link is only shown once when it is created.

Created share links can be managed from the user menu for an individual user, or from the admin panel for all users.

### Recipe import pipeline
The recipe import pipeline has been updated to use the `recipe-scrapers` Python package. This allows us to import recipes from a wider range of websites and is more reliable than the previous implementation. If results are worse for a specific site, please open an issue. The environment variable `LEGACY_RECIPE_PARSER_ROLLBACK` can be used temporarily to switch back to the old parser. This fallback will be removed in a future release.

### Local development and infrastructure

- Added a ready-to-use devcontainer setup for web and mobile development, including supporting Docker services.
- Refined the local Docker Compose setup with a shared base file and local override so the local stack keeps expected service names and ports.
- Updated README and contributor documentation for the new local development flow.

### Localization and language coverage

- Added Italian language support.
- Added Italian timer keywords and recurrence config updates.
- Added French localization for additional measurement units.

### UI and general fixes

- Made the entire mobile recipe card clickable.
- Fixed recipe card delete animation glitches.
- Fixed timeline viewport restore when prepending calendar items.
- Fixed UOM localization in the edit form.
- Added feedback when copying the household join code.
- Added support for recipes without images returning a proper `404` fallback.
- Fixed UUID generation and recipe creation bugs.
- Added new badges and polished mobile styling.
- Added proxy support for `yt-dlp` and exposed proxy configuration in video processing settings.
- Exposed AI timeout configuration and fixed related networking behavior.
- Fixed config saving issues.

## Update on the mobile app
A lot of work is going into the mobile app. This release cycle focused on getting the infrastructure ready for offline work. The current conflict model is version-based: every column has a version number that is incremented on every update. When coming back online, the app compares the local version with the remote version and updates the remote data if the local data is newer. This is a simple model, but it is a good start.

The app currently caches all data locally using MMKV. Any changes made are persisted locally and will be synced with the backend when the app comes back online.

Current focus:
- Thoroughly testing the offline functionality
- Making the calendar work with full offline support
- Making groceries work with full offline support

## Contributors

- @mikevanes
- @kw6423
- @AfoxDesignz
- @pfiorentino
- @jankosk
- @andre-silva-14
