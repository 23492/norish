# Implementation Tasks

## 1. Code Quality & Standards Fixes

- [ ] 1.1 Remove all AI-generated comments from timer-chip.tsx
- [ ] 1.2 Remove duplicate interface definition in smart-instruction.tsx (lines 9-13)
- [ ] 1.3 Reorganize imports in smart-instruction.tsx (move parseTimerDurations and useTimersEnabledQuery to top)
- [ ] 1.4 Remove unused uuid import from smart-instruction.tsx
- [ ] 1.5 Remove unnecessary comment in use-timers-enabled-query.ts:15
- [ ] 1.6 Add proper client-side logging using createClientLogger() in timer components
- [ ] 1.7 Remove design_docs/timer_feature.md file
- [ ] 1.8 Fix EOF formatting in all modified JSON files (add newline at end)

## 2. Icon Library Migration

- [ ] 2.1 Replace lucide-react imports with @heroicons/react/24/solid in timer-chip.tsx
- [ ] 2.2 Replace lucide-react imports with @heroicons/react/24/solid in timer-dock.tsx
- [ ] 2.3 Remove lucide-react from package.json dependencies
- [ ] 2.4 Run pnpm install to update lockfile

## 3. Critical Bug Fixes

- [ ] 3.1 Fix SmartInstruction component to properly render markdown (integrate SmartMarkdownRenderer)
- [ ] 3.2 Remove timersEnabled field from content-indicators.default.json

## 4. Timer Detection Configuration System

- [ ] 4.1 Create config/timer-keywords.default.json with structure:
  - [ ] 4.1.1 `enabled` field (boolean, default: true)
  - [ ] 4.1.2 `keywords` array with multilingual time unit keywords
  - [ ] 4.1.3 Include EN, DE, FR, NL defaults
  - [ ] 4.1.4 Add comprehensive keyword coverage (minute/min/mins, hour/hr/hrs, second/sec/secs variants)
- [ ] 4.2 Create TimerKeywordsSchema in server/db/zodSchemas/server-config.ts:
  - [ ] 4.2.1 Include `enabled`, `keywords`, and `isOverridden` fields
  - [ ] 4.2.2 Create TimerKeywordsInputSchema (omit isOverridden)
  - [ ] 4.2.3 Follow pattern from PromptsConfigSchema
- [ ] 4.3 Add getTimerKeywords() function in server/config/server-config-loader.ts:
  - [ ] 4.3.1 Load from DB if exists
  - [ ] 4.3.2 Fall back to default if not overridden
  - [ ] 4.3.3 Merge defaults with DB config when isOverridden=false
- [ ] 4.4 Create tRPC procedure config.timerKeywords in server/trpc/routers/config/procedures.ts
- [ ] 4.5 Create hooks/config/use-timer-keywords-query.ts hook
- [ ] 4.6 Add updateTimerKeywords mutation to hooks/admin/use-admin-mutations.ts:
  - [ ] 4.6.1 Set isOverridden=true when user saves custom config
  - [ ] 4.6.2 Invalidate timer keywords query on success
- [ ] 4.7 Update timer-parser.ts to accept keywords array parameter
- [ ] 4.8 Update SmartInstruction to pass configured keywords to parser
- [ ] 4.9 Add comprehensive tests for keyword-based parsing

## 5. Admin UI for Timer Keywords (with isOverridden pattern)

- [ ] 5.1 Add timer keywords section to content-detection-card.tsx
- [ ] 5.2 Add enable/disable toggle for timer feature
- [ ] 5.3 Add JsonEditor for timer keywords (similar to content indicators)
- [ ] 5.4 Display isOverridden indicator (show when using custom vs default config)
- [ ] 5.5 Add "Reset to Defaults" button (sets isOverridden=false)
- [ ] 5.6 Add i18n keys to settings.json:
  - [ ] 5.6.1 timerKeywords.title
  - [ ] 5.6.2 timerKeywords.subtitle
  - [ ] 5.6.3 timerKeywords.description
  - [ ] 5.6.4 timerKeywords.enabled.title/description
  - [ ] 5.6.5 timerKeywords.resetToDefaults (button label)
  - [ ] 5.6.6 timerKeywords.usingDefaults / usingCustom (status indicators)
- [ ] 5.7 Wire up mutation to save timer keywords config
- [ ] 5.8 Implement reset functionality that clears DB entry or sets isOverridden=false

## 6. Translation Cleanup

- [ ] 6.1 Check if "done" translation already exists in common.json
- [ ] 6.2 Remove duplicate timer.done and timer.done_action keys (use single key)
- [ ] 6.3 Update timer-dock.tsx to use simplified translation key
- [ ] 6.4 Verify all locale files have consistent structure

## 7. State Management Safeguards

- [ ] 7.1 Add null check safeguard in tick() function for edge case handling
- [ ] 7.2 Add logging when edge case occurs (running timer with null lastTickAt)
- [ ] 7.3 Update timer tests to cover edge case scenarios

## 8. Testing & Validation

- [ ] 8.1 Unit tests - Timer Parser:
  - [ ] 8.1.1 Run existing timer-parser.test.ts tests
  - [ ] 8.1.2 Add tests for keyword-based timer parsing
  - [ ] 8.1.3 Test with different keyword configurations (custom keywords)
  - [ ] 8.1.4 Test case-insensitive matching
- [ ] 8.2 Unit tests - Timer Store:
  - [ ] 8.2.1 Run stores/timers.test.ts tests
  - [ ] 8.2.2 Test edge case scenarios (null lastTickAt)
- [ ] 8.3 DB Integration tests - Timer Keywords Config:
  - [ ] 8.3.1 Test saving timer keywords to DB
  - [ ] 8.3.2 Test loading timer keywords from DB
  - [ ] 8.3.3 Test isOverridden flag behavior (true = use DB, false = use defaults)
  - [ ] 8.3.4 Test that updating defaults updates user config when isOverridden=false
  - [ ] 8.3.5 Test that updating defaults doesn't affect user config when isOverridden=true
  - [ ] 8.3.6 Test reset to defaults functionality
  - [ ] 8.3.7 Follow pattern from existing config integration tests
- [ ] 8.4 Manual tests - Timer Detection:
  - [ ] 8.4.1 Verify markdown renders correctly in active steps
  - [ ] 8.4.2 Verify timers work with EN/DE/FR/NL keywords
  - [ ] 8.4.3 Verify custom keywords work (add custom time unit like "dakika")
  - [ ] 8.4.4 Verify timer enable/disable toggle works
- [ ] 8.5 Manual tests - Admin UI:
  - [ ] 8.5.1 Verify admin can edit timer keywords
  - [ ] 8.5.2 Verify "Reset to Defaults" button works
  - [ ] 8.5.3 Verify isOverridden indicator updates correctly
  - [ ] 8.5.4 Verify saving custom config sets isOverridden=true
- [ ] 8.6 Full validation:
  - [ ] 8.6.1 Run full test suite: pnpm test:run
  - [ ] 8.6.2 Run linter: pnpm lint
  - [ ] 8.6.3 Run type check: pnpm build

## 9. Code Review & Documentation

- [ ] 9.1 Self-review all changes against project conventions
- [ ] 9.2 Verify all reviewer comments from PR #251 are addressed
- [ ] 9.3 Update PR description with changes made
- [ ] 9.4 Request re-review from mikevanes
