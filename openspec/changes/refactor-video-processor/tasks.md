## 1. Preparation

- [ ] 1.1 Add `VideoProcessor` interface and `ProcessorResult` type to `server/video/types.ts`
- [ ] 1.2 Create `BaseVideoProcessor` abstract class with shared utilities (download, save, cleanup)
- [ ] 1.3 Add platform detection utilities (`isYouTubeUrl`, `isFacebookUrl`) to `server/video/` or extend existing helpers

## 2. Platform Processors

- [ ] 2.1 Create `server/video/processors/instagram.ts` - extract Instagram logic from current processor
- [ ] 2.2 Create `server/video/processors/youtube.ts` - extract YouTube caption-first logic
- [ ] 2.3 Create `server/video/processors/facebook.ts` - mirror Instagram behavior
- [ ] 2.4 Create `server/video/processors/generic.ts` - transcription-based fallback for other platforms

## 3. Factory Integration

- [ ] 3.1 Create `VideoProcessorFactory` in `server/video/processor.ts` to route URLs to processors
- [ ] 3.2 Update `processVideoRecipe()` to delegate to factory
- [ ] 3.3 Remove legacy inline platform logic from processor.ts

## 4. Cleanup

- [ ] 4.1 Remove or deprecate standalone functions from `server/video/instagram.ts` (now in processor class)
- [ ] 4.2 Update imports in `server/parser/index.ts` if needed
- [ ] 4.3 Verify all existing functionality works (manual testing)

## 5. Validation

- [ ] 5.1 Add unit tests for each platform processor
- [ ] 5.2 Add integration test for factory URL routing
- [ ] 5.3 Run existing test suite to confirm no regressions
