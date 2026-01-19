# Calendar Sorting: Unified Planned Items

## Context

### Original Request

Implement sorting of planned recipes/notes with drag-and-drop support. Should work cross-days, cross-slots, and within slots. TDD approach required. DnD container exists but needs refactoring.

### Interview Summary

**Key Discussions**:

- Sorting scope: Per-container (date, slot) with interleaved recipes+notes
- Data model: Unified `planned_items` table replacing `planned_recipes` + `notes`
- Simple sequential integers (0,1,2,3) with reindexing on insert
- Atomic updates instead of delete+create pattern
- Real-time sync: emit on drop only

**Research Findings**:

- Current schema has NO sortOrder column
- DnD uses dnd-kit; calendar uses `useDroppable` (should use `useSortable`)
- Current slot moves use destructive delete+create in `context.tsx`
- Test infrastructure: Vitest + Testing Library with mocked repositories
- Existing test utils already reference `sortOrder` (partial prior work)

### Metis Review

**Identified Gaps** (addressed):

- Ordering model: Decided on interleaved with unified table
- API contract: Move operation with itemId, itemType, targetDate, targetSlot, newIndex
- Reindexing: Both source and destination containers
- No-op drops: Skip if position unchanged
- Conflict resolution: Last-write-wins with transactions

---

## Work Objectives

### Core Objective

Refactor the calendar planning system to use a unified `planned_items` table with proper sort ordering, enabling drag-and-drop reordering within and across slots/days.

### Concrete Deliverables

- New `planned_items` table with `sortOrder` column
- Repository layer for unified planned items
- tRPC mutations: `moveItem`, `reorderItems`
- Refactored DnD hooks using `useSortable` pattern
- WebSocket events for real-time household sync
- Full test coverage (TDD approach)

### Definition of Done

- [ ] `pnpm test` passes with new tests for all mutations
- [ ] Drag-and-drop works within slot, across slots, across days
- [ ] Order persists after page refresh
- [ ] Household members see reorder changes in real-time
- [ ] Old `planned_recipes` and `notes` tables removed

### Must Have

- Unified data model with single `planned_items` table
- Atomic move/reorder operations (no delete+create)
- TDD: tests written before implementation
- Real-time sync on drop

### Must NOT Have (Guardrails)

- DO NOT modify groceries DnD code
- DO NOT change frontend styling (already complete)
- DO NOT use fractional indexing (simple integers decided)
- DO NOT introduce new DnD libraries (use existing dnd-kit)
- DO NOT add new permission models (use existing edit permissions)
- DO NOT emit events during drag (only on drop)

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES (Vitest + Testing Library)
- **User wants tests**: TDD
- **Framework**: Vitest

### TDD Workflow

Each backend TODO follows RED-GREEN-REFACTOR:

1. **RED**: Write failing test first
2. **GREEN**: Implement minimum code to pass
3. **REFACTOR**: Clean up while keeping green

---

## Task Flow

```
Schema + Cleanup (1) → Repository (2) → tRPC Mutations (3,4) → Events (5)
                                                                    ↓
Frontend: Types (6) → Hooks Refactor (7) → DnD Refactor (8) → Context Cleanup (9)
                                                                    ↓
                                                        Integration Test (10)
```

## Parallelization

| Group | Tasks | Reason                                                     |
| ----- | ----- | ---------------------------------------------------------- |
| A     | 6, 7  | Frontend types and hooks can start after backend mutations |
| B     | 3, 4  | tRPC mutations are independent of each other               |

| Task | Depends On | Reason                            |
| ---- | ---------- | --------------------------------- |
| 2    | 1          | Repository needs schema           |
| 3, 4 | 2          | Mutations need repository         |
| 5    | 3, 4       | Events emitted from mutations     |
| 8    | 7          | DnD refactor needs updated hooks  |
| 9    | 8          | Context cleanup after DnD works   |
| 10   | 5, 9       | Integration test needs everything |

---

## TODOs

- [x] 1. Create `planned_items` schema and remove old tables

  **What to do**:
  - Create new schema file `server/db/schema/planned-items.ts`
  - Define `plannedItems` table with columns: id, userId, date, slot, sortOrder, itemType, recipeId (nullable), title (nullable), createdAt, updatedAt
  - Define `itemTypeEnum` for 'recipe' | 'note'
  - Add proper foreign key references (userId → users, recipeId → recipes)
  - Export from `server/db/schema/index.ts`
  - Remove old schema files:
    - `server/db/schema/planned-recipe.ts`
    - `server/db/schema/notes.ts`
  - Remove old repositories:
    - `server/db/repositories/planned-recipe.ts`
    - `server/db/repositories/notes.ts`
  - Remove old routers:
    - `server/trpc/routers/calendar/planned-recipes.ts`
    - `server/trpc/routers/calendar/notes.ts`
  - Remove old types from `types/dto/planned-recipe.d.ts`
  - Update `server/trpc/routers/calendar/index.ts` to remove old router exports
  - Run `pnpm db:generate` to generate migration

  **Must NOT do**:
  - Do not add CHECK constraints in Drizzle (handle in app layer)

  **Parallelizable**: NO (foundation for everything)

  **References**:

  **Pattern References**:
  - `server/db/schema/planned-recipe.ts` - Existing schema pattern with slotTypeEnum, foreign keys (to be removed)
  - `server/db/schema/notes.ts` - Note structure to merge (to be removed)
  - `server/db/schema/index.ts` - How schemas are exported

  **Type References**:
  - `types/dto/planned-recipe.d.ts:CalendarItemViewDto` - Target unified type structure

  **Acceptance Criteria**:
  - [ ] Test: Schema file compiles without TypeScript errors
  - [ ] `pnpm db:generate` succeeds and creates migration file
  - [ ] App starts and migrates: `pnpm dev` → migration runs on startup
  - [ ] Verify in database: `\d planned_items` shows all columns with correct types
  - [ ] Verify: `sortOrder` column exists with INTEGER type
  - [ ] Verify: `itemType` column exists with TEXT type
  - [ ] Verify: Old tables `planned_recipes` and `notes` no longer exist
  - [ ] `pnpm build` succeeds with no references to old tables

  **Commit**: YES
  - Message: `feat(db): replace planned_recipes and notes with unified planned_items table`
  - Files: `server/db/schema/planned-items.ts`, `server/db/schema/index.ts`, removed files

---

- [x] 2. Create `planned-items` repository with TDD

  **What to do**:
  - Write tests FIRST in `__tests__/trpc/calendar/planned-items-repository.test.ts`
  - Test cases:
    - `listByUserAndDateRange`: returns items sorted by date, slot, sortOrder
    - `listBySlot`: returns items for specific (date, slot) sorted by sortOrder
    - `create`: inserts with correct sortOrder (end of slot)
    - `update`: updates item fields atomically
    - `delete`: removes item and reindexes remaining
    - `moveItem`: moves item to new (date, slot, index), reindexes both containers
    - `reorderInSlot`: reorders items within same slot
    - `getMaxSortOrder`: returns highest sortOrder for (date, slot)
  - Implement repository in `server/db/repositories/planned-items.ts`
  - Use transactions for multi-row updates

  **Must NOT do**:
  - Do not expose raw `db` queries outside repository
  - Do not skip the reindex step after move/delete

  **Parallelizable**: NO (depends on schema)

  **References**:

  **Pattern References**:
  - `server/db/repositories/planned-recipe.ts` - Repository pattern with Drizzle queries
  - `server/db/repositories/notes.ts` - Similar CRUD operations
  - `server/db/repositories/grocery-items.ts:updateGroceryItemsOrder` - Batch reorder pattern

  **Test References**:
  - `__tests__/mocks/db.ts` - Database mock structure
  - `__tests__/trpc/recipes/test-utils.ts` - Mock context creation pattern

  **Acceptance Criteria**:
  - [ ] RED: `pnpm test planned-items-repository` → tests fail (no implementation)
  - [ ] GREEN: `pnpm test planned-items-repository` → all tests pass
  - [ ] Test: `listBySlot` returns items in sortOrder sequence
  - [ ] Test: `moveItem` correctly reindexes source and destination slots
  - [ ] Test: `create` assigns sortOrder = max + 1 for slot

  **Commit**: YES
  - Message: `feat(db): add planned-items repository with reorder support`
  - Files: `server/db/repositories/planned-items.ts`, `__tests__/trpc/calendar/planned-items-repository.test.ts`, `__tests__/mocks/planned-items.ts`

---

- [x] 3. Create `moveItem` tRPC mutation with TDD

  **What to do**:
  - Write tests FIRST in `__tests__/trpc/calendar/planned-items.test.ts`
  - Test cases:
    - Success: move within same slot (reorder)
    - Success: move to different slot same day
    - Success: move to different day
    - Success: no-op when position unchanged (skip DB write)
    - Error: item not found
    - Error: no permission to edit
  - Implement mutation in `server/trpc/routers/calendar/planned-items.ts`
  - Input schema: `{ itemId: string, targetDate: string, targetSlot: SlotType, targetIndex: number }`
  - Use `authedProcedure` for auth
  - Call repository `moveItem` method

  **Must NOT do**:
  - Do not use delete+create pattern
  - Do not emit event here (separate task)

  **Parallelizable**: YES (with task 4)

  **References**:

  **Pattern References**:
  - `server/trpc/routers/calendar/planned-recipes.ts` - Existing calendar router structure
  - `server/trpc/routers/calendar/notes.ts` - Similar mutation patterns
  - `server/trpc/routers/groceries/grocery-items.ts:reorderGroceryItems` - Reorder mutation pattern

  **Test References**:
  - `__tests__/trpc/calendar/test-utils.ts` - Calendar test utilities
  - `__tests__/trpc/recipes/recipes.test.ts` - tRPC test pattern with createCallerFactory

  **Acceptance Criteria**:
  - [ ] RED: `pnpm test planned-items.test` → mutation tests fail
  - [ ] GREEN: `pnpm test planned-items.test` → all pass
  - [ ] Test: Moving item from index 2 to index 0 reorders correctly
  - [ ] Test: Cross-slot move updates date+slot+sortOrder atomically
  - [ ] Test: No-op drop returns early without DB write

  **Commit**: YES
  - Message: `feat(trpc): add moveItem mutation for calendar items`
  - Files: `server/trpc/routers/calendar/planned-items.ts`, `__tests__/trpc/calendar/planned-items.test.ts`

---

- [x] 4. Create `createItem` and `deleteItem` tRPC mutations with TDD

  **What to do**:
  - Add tests for create/delete in `__tests__/trpc/calendar/planned-items.test.ts`
  - Test cases for `createItem`:
    - Success: creates recipe item at end of slot
    - Success: creates note item at end of slot
    - Success: creates item at specific index
    - Error: invalid itemType
  - Test cases for `deleteItem`:
    - Success: deletes item and reindexes slot
    - Error: item not found
    - Error: no permission
  - Implement in `server/trpc/routers/calendar/planned-items.ts`
  - Input schemas with Zod validation

  **Must NOT do**:
  - Do not allow creating item without assigning sortOrder

  **Parallelizable**: YES (with task 3)

  **References**:

  **Pattern References**:
  - `server/trpc/routers/calendar/planned-recipes.ts:createRecipe` - Create pattern
  - `server/trpc/routers/calendar/notes.ts:deleteNote` - Delete pattern

  **Type References**:
  - `server/db/schema/planned-items.ts` - Schema types for validation

  **Acceptance Criteria**:
  - [ ] RED: Tests fail for create/delete
  - [ ] GREEN: All create/delete tests pass
  - [ ] Test: Created item has sortOrder = max + 1
  - [ ] Test: After delete, remaining items have contiguous sortOrder (0,1,2...)

  **Commit**: YES
  - Message: `feat(trpc): add createItem and deleteItem mutations`
  - Files: `server/trpc/routers/calendar/planned-items.ts`, `__tests__/trpc/calendar/planned-items.test.ts`

---

- [x] 5. Add WebSocket events for planned items

  **What to do**:
  - Add event types to `server/trpc/emitter.ts`:
    - `plannedItemCreated`
    - `plannedItemUpdated`
    - `plannedItemDeleted`
    - `plannedItemMoved`
  - Emit events from tRPC mutations after successful DB operations
  - Create subscription in `server/trpc/routers/calendar/planned-items.ts`
  - Ensure events include householdId for filtering

  **Must NOT do**:
  - Do not emit during drag (only on drop/mutation complete)
  - Do not change existing recipe/note event structure yet

  **Parallelizable**: NO (depends on mutations)

  **References**:

  **Pattern References**:
  - `server/trpc/emitter.ts` - Typed event emitter setup
  - `server/trpc/routers/calendar/planned-recipes.ts` - Existing event emission pattern
  - `server/trpc/routers/groceries/grocery-items.ts` - Event emission after reorder

  **API References**:
  - `hooks/calendar/use-calendar-subscriptions.ts` - How frontend subscribes

  **Acceptance Criteria**:
  - [ ] Verify: Event types added to emitter without TypeScript errors
  - [ ] Test: Call moveItem mutation → `plannedItemMoved` event emitted
  - [ ] Test: Event payload includes itemId, date, slot, sortOrder, householdId

  **Commit**: YES
  - Message: `feat(trpc): add WebSocket events for planned items`
  - Files: `server/trpc/emitter.ts`, `server/trpc/routers/calendar/planned-items.ts`

---

- [x] 6. Update TypeScript types and DTOs

  **What to do**:
  - Create `types/dto/planned-item.d.ts` with:

    ```typescript
    type PlannedItemType = "recipe" | "note";

    interface PlannedItemBase {
      id: string;
      date: string;
      slot: SlotType;
      sortOrder: number;
      itemType: PlannedItemType;
      createdAt: string;
      updatedAt: string;
    }

    interface PlannedRecipeItem extends PlannedItemBase {
      itemType: "recipe";
      recipeId: string;
      recipeName: string | null;
      recipeImage: string | null;
      servings: number | null;
      calories: number | null;
      allergyWarnings?: string[];
    }

    interface PlannedNoteItem extends PlannedItemBase {
      itemType: "note";
      title: string;
      recipeId: string | null; // linked recipe
    }

    type PlannedItemViewDto = PlannedRecipeItem | PlannedNoteItem;
    ```

  - Update `CalendarItemViewDto` to use new types (or deprecate)
  - Export from `types/dto/index.d.ts`

  **Must NOT do**:
  - Do not remove old types yet (needed during transition)

  **Parallelizable**: YES (with task 8)

  **References**:

  **Pattern References**:
  - `types/dto/planned-recipe.d.ts` - Existing DTO patterns
  - `types/dto/grocery-item.d.ts` - Discriminated union example

  **Acceptance Criteria**:
  - [ ] Types compile without errors
  - [ ] Discriminated union works: `item.itemType === 'recipe'` narrows type
  - [ ] `sortOrder` is required number field

  **Commit**: YES
  - Message: `feat(types): add PlannedItemViewDto with sortOrder`
  - Files: `types/dto/planned-item.d.ts`, `types/dto/index.d.ts`

---

- [x] 7. Refactor calendar hooks to use new unified API

  **What to do**:
  - Update `hooks/calendar/use-calendar-query.ts`:
    - Query new `plannedItems.list` instead of separate recipes/notes
    - Remove merge logic (server returns unified sorted list)
  - Update `hooks/calendar/use-calendar-mutations.ts`:
    - Replace `createPlannedRecipe`/`createNote` with `createItem`
    - Replace `deletePlannedRecipe`/`deleteNote` with `deleteItem`
    - Add `moveItem` mutation hook
  - Update `hooks/calendar/use-calendar-subscriptions.ts`:
    - Subscribe to new planned item events
    - Update React Query cache on events

  **Must NOT do**:
  - Do not change hook API signatures if possible (minimize component changes)

  **Parallelizable**: YES (with task 7)

  **References**:

  **Pattern References**:
  - `hooks/calendar/use-calendar-query.ts` - Current query structure
  - `hooks/calendar/use-calendar-mutations.ts` - Current mutation hooks
  - `hooks/groceries/use-grocery-mutations.ts` - Reorder mutation pattern

  **Acceptance Criteria**:
  - [ ] Hooks compile without TypeScript errors
  - [ ] `useCalendarQuery` returns items with `sortOrder` field
  - [ ] `useMoveItem` mutation hook exists and is typed

  **Commit**: YES
  - Message: `refactor(hooks): update calendar hooks for unified planned items`
  - Files: `hooks/calendar/use-calendar-query.ts`, `hooks/calendar/use-calendar-mutations.ts`, `hooks/calendar/use-calendar-subscriptions.ts`

---

- [x] 8. Refactor DnD to use `useSortable` for slots

  **What to do**:
  - Update `components/calendar/calendar-slot.tsx`:
    - Change from `useDroppable` to `useSortable` (match groceries pattern)
    - Wrap items in `SortableContext` with `verticalListSortingStrategy`
  - Update `hooks/calendar/use-calendar-dnd.ts`:
    - Implement proper `handleDragOver` for cross-container preview
    - Implement `handleDragEnd` to call `moveItem` mutation
    - Calculate target index from dnd-kit's `over` data
    - Skip mutation if position unchanged (no-op)
  - Update `components/calendar/dnd-calendar-provider.tsx`:
    - Ensure `DragOverlay` shows dragged item
    - Use collision detection from groceries pattern

  **Must NOT do**:
  - Do not change item visual styling
  - Do not modify groceries DnD code

  **Parallelizable**: NO (depends on hooks refactor)

  **References**:

  **Pattern References**:
  - `components/groceries/dnd/dnd-grocery-provider.tsx` - Multi-container DnD pattern
  - `components/groceries/dnd/use-grocery-dnd.ts` - handleDragOver/handleDragEnd logic
  - `components/groceries/dnd/sortable-store-container.tsx` - Container with useSortable
  - `components/groceries/dnd/collision-detection.ts` - Custom collision detection

  **Current Code**:
  - `components/calendar/calendar-slot.tsx` - Current useDroppable (to refactor)
  - `hooks/calendar/use-calendar-dnd.ts` - Current DnD logic (to refactor)

  **Acceptance Criteria**:
  - [ ] Drag item within slot → items reorder visually during drag
  - [ ] Drop item within slot → `moveItem` mutation called → order persists
  - [ ] Drag item to different slot → item appears in target slot during drag
  - [ ] Drop in different slot → mutation called with new date/slot/index
  - [ ] Drop in same position → no mutation called (no-op)

  **Commit**: YES
  - Message: `refactor(dnd): use useSortable pattern for calendar slots`
  - Files: `components/calendar/calendar-slot.tsx`, `hooks/calendar/use-calendar-dnd.ts`, `components/calendar/dnd-calendar-provider.tsx`

---

- [x] 9. Remove delete+create pattern from context

  **What to do**:
  - Update `app/(app)/calendar/context.tsx`:
    - Remove `updateItemSlot` function that uses delete+create
    - Replace with call to `moveItem` mutation
    - Simplify context to only manage UI state, not data mutations
  - Verify all slot/date changes go through `moveItem`

  **Must NOT do**:
  - Do not leave any delete+create patterns for moves

  **Parallelizable**: NO (depends on DnD refactor)

  **References**:

  **Pattern References**:
  - `app/(app)/calendar/context.tsx:updateItemSlot` - Current delete+create (to remove)
  - `hooks/calendar/use-calendar-mutations.ts` - Where mutations should live

  **Acceptance Criteria**:
  - [ ] No `deletePlannedRecipe` followed by `createPlannedRecipe` in context
  - [ ] `updateItemSlot` function removed or refactored to use `moveItem`
  - [ ] All item moves are atomic single mutations

  **Commit**: YES
  - Message: `refactor(calendar): remove delete+create pattern, use atomic moves`
  - Files: `app/(app)/calendar/context.tsx`

---

- [ ] 10. Integration test: end-to-end DnD flow

  **What to do**:
  - Create integration test in `__tests__/integration/calendar-dnd.test.ts`
  - Test scenarios:
    - Reorder within slot: item moves from index 2 to index 0
    - Cross-slot move: item moves from Monday Breakfast to Monday Dinner
    - Cross-day move: item moves from Monday to Wednesday
    - Real-time sync: second client sees reorder after first client drops
  - Use Testing Library for component testing
  - Mock tRPC but verify mutation calls

  **Must NOT do**:
  - Do not require real database (use mocks)

  **Parallelizable**: NO (needs everything working)

  **References**:

  **Pattern References**:
  - `__tests__/integration/` - Existing integration test patterns
  - `__tests__/hooks/calendar/` - Calendar hook test setup

  **Acceptance Criteria**:
  - [ ] `pnpm test calendar-dnd.test` passes
  - [ ] Test verifies: drag item A below item B → A.sortOrder > B.sortOrder
  - [ ] Test verifies: cross-slot move updates date/slot fields

  **Commit**: YES
  - Message: `test(calendar): add integration tests for DnD reordering`
  - Files: `__tests__/integration/calendar-dnd.test.ts`

---

## Commit Strategy

| After Task | Message                                                              | Files                  | Verification                   |
| ---------- | -------------------------------------------------------------------- | ---------------------- | ------------------------------ |
| 1          | `feat(db): replace planned_recipes/notes with unified planned_items` | schema + removed files | `pnpm db:generate && pnpm dev` |
| 2          | `feat(db): add planned-items repository`                             | repo + tests           | `pnpm test`                    |
| 3          | `feat(trpc): add moveItem mutation`                                  | router + tests         | `pnpm test`                    |
| 4          | `feat(trpc): add create/delete mutations`                            | router + tests         | `pnpm test`                    |
| 5          | `feat(trpc): add WebSocket events`                                   | emitter + router       | `pnpm test`                    |
| 6          | `feat(types): add PlannedItemViewDto`                                | type files             | `pnpm build`                   |
| 7          | `refactor(hooks): update calendar hooks`                             | hook files             | `pnpm test`                    |
| 8          | `refactor(dnd): use useSortable pattern`                             | component files        | manual test                    |
| 9          | `refactor(calendar): remove delete+create`                           | context file           | `pnpm build`                   |
| 10         | `test(calendar): add integration tests`                              | test files             | `pnpm test`                    |

---

## Success Criteria

### Verification Commands

```bash
pnpm test                    # All tests pass
pnpm build                   # Build succeeds
pnpm lint                    # No lint errors
pnpm db:generate             # Migration generated
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] DnD works: within slot, cross-slot, cross-day
- [ ] Order persists after refresh
- [ ] Real-time sync works for household members
- [ ] No delete+create patterns remain
- [ ] Old tables removed (planned_recipes, notes)
