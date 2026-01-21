## Context

The video processor currently handles multiple platforms in a single 250-line function with nested conditionals. The code path varies significantly by platform:

1. **Instagram**: Detect image vs video posts, handle description-only extraction for images
2. **YouTube**: Prefer captions over transcription, combine with description
3. **Generic**: Always transcribe audio, use description as supplement

Adding Facebook (which behaves like Instagram) would add more branches. A strategy pattern isolates each platform's logic.

## Goals / Non-Goals

**Goals:**

- Separate platform-specific logic into dedicated, testable classes
- Make adding new platforms straightforward (implement interface, register in factory)
- Preserve all existing behavior (no functional changes)
- Improve code readability and maintainability

**Non-Goals:**

- Adding new platforms beyond Facebook (out of scope)
- Changing the AI extraction or transcription logic
- Modifying the yt-dlp wrapper or video download utilities

## Decisions

### Decision: Strategy Pattern with Factory

Use a `VideoProcessor` interface with platform-specific implementations, selected by a factory based on URL.

**Alternatives considered:**

- **Keep monolithic function**: Rejected - complexity will only grow
- **Simple if/else refactor**: Rejected - doesn't improve testability
- **Plugin system**: Rejected - over-engineered for 4 platforms

### Decision: Shared Base Class

Create `BaseVideoProcessor` with common utilities (video download, save, cleanup) that platform processors extend.

**Rationale:** Avoids code duplication for common operations like downloading videos and saving to recipes.

### Decision: Processor Directory Structure

```
server/video/
├── processor.ts          # Factory + main entry point
├── base-processor.ts     # Abstract base class
├── processors/
│   ├── instagram.ts      # Instagram handler
│   ├── facebook.ts       # Facebook handler (mirrors Instagram)
│   ├── youtube.ts        # YouTube handler
│   └── generic.ts        # Fallback for other platforms
├── yt-dlp.ts             # Unchanged
├── normalizer.ts         # Unchanged
├── types.ts              # Add ProcessorResult type
└── cleanup.ts            # Unchanged
```

## Risks / Trade-offs

| Risk                                | Mitigation                                          |
| ----------------------------------- | --------------------------------------------------- |
| Behavior regression during refactor | Write tests for current behavior before refactoring |
| Over-abstraction                    | Keep base class minimal, only shared utilities      |
| Factory complexity                  | Simple URL-based matching, no dynamic loading       |

## Migration Plan

1. Add new processor interface and base class (non-breaking)
2. Implement each platform processor, extracting logic from current code
3. Create factory that delegates to processors
4. Update `processVideoRecipe()` to use factory
5. Remove old inline logic
6. Add/update tests for each processor

**Rollback:** If issues arise, revert the processor.ts changes - the refactor is contained to the video module.

## Open Questions

None - the platform behaviors are well-defined in the user request.
