# Calendar Sorting - Learnings

## Key Decisions

| Decision                                | Rationale                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Unified `planned_items` table           | Single source of truth for recipes and notes, simplifies queries and sorting |
| Simple integers for sortOrder (0,1,2,3) | Easy reindexing, no fractional indexing complexity                           |
| Atomic `moveItem` operation             | No delete+create pattern, prevents race conditions                           |
| Per-container sorting                   | Items sorted within (date, slot) containers                                  |
| TDD approach                            | Tests written before implementation, 27 tests total                          |
| Events on drop only                     | No real-time updates during drag, only after mutation completes              |

## Patterns Used

### Repository Pattern

- All DB access through `server/db/repositories/planned-items.ts`
- Never direct `db` queries in routers
- Transactions for multi-row updates (reindexing)

### WebSocket Events

- Events defined in `server/trpc/routers/calendar/types.ts`
- Subscriptions in `server/trpc/routers/calendar/subscriptions.ts`
- Mutations emit events after successful DB operations
- Events include householdId for filtering

### Discriminated Union Types

- `PlannedItemViewDto = PlannedRecipeItem | PlannedNoteItem`
- `itemType` field discriminates: `'recipe' | 'note'`
- Enables type narrowing: `if (item.itemType === 'recipe') { ... }`

## Files Changed Summary

### Backend (Tasks 1-5)

- `server/db/schema/planned-items.ts` - New unified schema
- `server/db/repositories/planned-items.ts` - Repository with 10 functions
- `server/trpc/routers/calendar/planned-items.ts` - Router with listItems, createItem, deleteItem, moveItem
- `server/trpc/routers/calendar/types.ts` - Event types
- `server/trpc/routers/calendar/subscriptions.ts` - WebSocket subscriptions

### Types (Task 6)

- `types/dto/planned-item.d.ts` - New discriminated union DTO
- `types/index.ts` - Export added

### Frontend (Tasks 7-9)

- `hooks/calendar/use-calendar-query.ts` - Uses `trpc.calendar.listItems`
- `hooks/calendar/use-calendar-mutations.ts` - Exposes createItem, deleteItem, moveItem
- `hooks/calendar/use-calendar-subscription.ts` - Subscribes to item events
- `hooks/calendar/use-calendar-dnd.ts` - Uses atomic moveItem API
- `app/(app)/calendar/context.tsx` - Simplified to use new mutations
- `components/calendar/calendar-slot.tsx` - Updated for new context
- `components/calendar/edit-note-panel.tsx` - Uses moveItem
- `components/Panel/consumers/mini-recipes.tsx` - Uses simplified planMeal
- `components/Panel/consumers/mini-calendar.tsx` - Uses createItem

### Tests

- `__tests__/trpc/calendar/planned-items-repository.test.ts` - 13 tests
- `__tests__/trpc/calendar/planned-items.test.ts` - 14 tests

## Technical Notes

- Reindexing happens on both source and destination containers during moves
- No-op detection: skip DB write if position unchanged
- Permission checks use existing authedProcedure pattern
- Old tables (planned_recipes, notes) removed in migration
