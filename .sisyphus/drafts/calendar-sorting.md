# Draft: Calendar Sorting Feature

## Requirements (confirmed)

- User wants sorting of planned recipes/notes
- Cross-day and cross-slot sorting required
- Within-slot sorting required
- TDD approach requested
- DnD container exists but needs refactoring
- Frontend styling already done

## Technical Decisions

- **DnD Library**: dnd-kit (already in use)
- **Test Framework**: Vitest + Testing Library (established)

## Research Findings

### Current Data Model (NO sorting support)

- `planned_recipes`: id, userId, recipeId, date, slot, createdAt, updatedAt
- `notes`: id, userId, title, recipeId, date, slot, createdAt, updatedAt
- **Missing**: `sortOrder` column

### Current DnD Implementation

- Files:
  - `/home/mike/norish/components/calendar/dnd-calendar-provider.tsx`
  - `/home/mike/norish/hooks/calendar/use-calendar-dnd.ts`
  - `/home/mike/norish/components/calendar/calendar-slot.tsx` (useDroppable)
  - `/home/mike/norish/components/calendar/calendar-item.tsx` (useSortable)
- Issues:
  - Uses `useDroppable` for slots (should use `useSortable` like groceries)
  - Delete+create pattern for slot moves (destructive)
  - No backend reorder mutation

### Data Model Options for sortOrder

1. **Fractional indexing** (recommended): Decimals (1.0, 1.5, 2.0). Never reindex.
2. **Gap-based**: Integers with gaps (100, 200, 300). Occasional compaction.
3. **Linked list**: Each item → next. Complex queries.
4. **Array index**: 0,1,2,3. Reindex on every insert.

### Test Patterns (from existing codebase)

- Backend: Mock repositories → createCallerFactory → test procedures
- Frontend: Mock tRPC → renderHook with QueryClientProvider

## Decisions Made (from interview)

1. **Sorting scope**: Per-container (date, slot) - each slot has independent 0-based ordering
2. **Data model**: Simple sequential integers (0, 1, 2, 3...) with reindexing on insert
3. **Atomic updates**: YES - fix delete+create anti-pattern, use UPDATE instead
4. **Real-time sync**: Emit event only on drop (not during drag) - standard pattern
5. **Default position on cross-container move**: End of target container (or specific index if dropped between items)
6. **Ordering across types**: INTERLEAVED - recipes and notes share a unified sortOrder sequence per (date, slot)
7. **DATA MODEL REFACTOR**: Unify `planned_recipes` + `notes` into single `planned_items` table

## New Data Model (planned_items)

```sql
planned_items:
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
  userId      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  date        DATE NOT NULL
  slot        slot_type NOT NULL  -- 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
  sortOrder   INTEGER NOT NULL DEFAULT 0
  itemType    TEXT NOT NULL  -- 'recipe' | 'note'

  -- Recipe-specific (NULL for notes)
  recipeId    UUID REFERENCES recipes(id) ON DELETE CASCADE

  -- Note-specific (NULL for recipes)
  title       TEXT

  createdAt   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  updatedAt   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()

  -- Constraints
  UNIQUE (date, slot, sortOrder)  -- No duplicate positions
  CHECK (
    (itemType = 'recipe' AND recipeId IS NOT NULL AND title IS NULL) OR
    (itemType = 'note' AND title IS NOT NULL)  -- recipeId optional for notes (linked notes)
  )
```

## Migration Strategy

1. Create new `planned_items` table
2. Migrate data from `planned_recipes` (itemType='recipe')
3. Migrate data from `notes` (itemType='note')
4. Assign sortOrder based on createdAt within each (date, slot)
5. Drop old tables after verification
6. Update all repositories, routers, hooks to use new table

## Metis Review - Resolved Gaps

| Gap                    | Resolution                                                                   |
| ---------------------- | ---------------------------------------------------------------------------- |
| Ordering model         | Interleaved: shared sortOrder sequence across recipes+notes per (date, slot) |
| API contract           | Move operation (itemId, itemType, targetDate, targetSlot, newIndex)          |
| Source/dest reindexing | Yes, reindex both containers in transaction                                  |
| No-op drops            | Skip DB writes if position unchanged                                         |
| Conflict resolution    | Last-write-wins with transactions                                            |
| SortOrder gaps         | Always reindex to contiguous (0,1,2,3)                                       |
| Permissions            | Use existing edit permissions                                                |
| Event payload          | Emit moved item with new slot/date/sortOrder; clients refetch slot           |

## Scope Boundaries

- INCLUDE:
  - Add `sortOrder` column to `planned_recipes` and `notes` tables
  - Migration to set initial sortOrder values
  - Repository methods for reordering
  - tRPC mutation for reorder (handles cross-container + within-container)
  - tRPC mutation for atomic slot/date update (replace delete+create)
  - Refactor DnD calendar hooks to use new mutations
  - Refactor calendar slots to use `useSortable` (match groceries pattern)
  - TDD: tests first for all backend changes
  - WebSocket event emission on drop for household sync
- EXCLUDE:
  - Frontend styling changes (already done per user)
  - Groceries DnD refactoring (separate concern)
  - Other calendar features
