# Change: Refactor Video Processor with Platform-Specific Implementations

## Why

The current video processor (`server/video/processor.ts`) has grown into a large monolithic function with complex branching logic for different platforms (Instagram, YouTube, generic video). This makes the code difficult to maintain, test, and extend. Adding Facebook support would further increase complexity.

## What Changes

- **BREAKING**: Refactor monolithic `processVideoRecipe()` into a strategy pattern with dedicated platform handlers
- Extract platform-specific logic into separate processor implementations:
  - `InstagramProcessor`: Handle image posts (parse image + description) and video posts
  - `FacebookProcessor`: Same behavior as Instagram (image/video detection with description parsing)
  - `YouTubeProcessor`: Download video, prefer captions + description, fallback to AI transcription
  - `GenericVideoProcessor`: Download video, transcribe audio, use description as fallback
- Create a `VideoProcessorFactory` to route URLs to the appropriate processor
- Improve testability by isolating platform-specific behavior

## Impact

- Affected specs: `video-import`
- Affected code:
  - `server/video/processor.ts` - Complete rewrite into factory + base class
  - `server/video/instagram.ts` - Refactor into `InstagramProcessor` class
  - `server/video/processors/` - New directory for platform implementations
  - `server/helpers.ts` - May need platform detection utilities
