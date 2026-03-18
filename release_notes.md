# v0.17.3-beta

## Summary

This release focuses on import reliability, localization coverage, auth and security fixes, and a set of quality-of-life improvements across web, parsing, and deployment docs.

## Fixes and Improvements

### Importing and parsing

- Added support for legacy Mealie archive imports (folder-per-recipe format) with image handling and full DTO conversion.
- Added test coverage for legacy archive detection, extraction, fallbacks, and conversion behavior.
- Improved recipe image detection by scanning full HTML in the parser layer while keeping token-optimized AI inputs.
- Tightened yt-dlp MP4 selection and codec normalization for better browser playback compatibility.

### Localization and units

- Added Polish translations.
- Added Danish translations plus Danish timer keywords, NLP config, and UOM coverage.
- Updated default UOM data, including centimeter support and additional locale alternates.
- Added UOM pluralization improvements with dedicated tests.

### Auth, config, and security

- Fixed API key config id handling.
- Fixed account linking behavior.
- Fixed credential logging issue.
- Added support for composing `DATABASE_URL` from deconstructed database environment variables.
- Updated package versions for the `0.17.3-beta` release line.

### UI and docs

- Improved AuthCard logo alignment.
- Raised mobile favorite button placement to avoid overlap with video controls.
- Replaced OTP text input with an OTP input component.
- Improved Docker Compose documentation in README and linked to full compose template.

### Internal maintenance

- Removed duplicate packages and cleaned leftover dependencies.
- Moved tests into their correct workspace packages.
- Updated Ollama provider integration to `ai-sdk-ollama` for structured parsing support.

## Contributors

- @mikevanes
- @AfoxDesignz
- @keunes
- @madrobot-collab
