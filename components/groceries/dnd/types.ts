import type { GroceryDto, StoreDto, RecurringGroceryDto } from "@/types";
import type { GroceryGroup } from "@/lib/grocery-grouping";

// =============================================================================
// Constants
// =============================================================================

/**
 * Container ID for groceries without a store assignment.
 */
export const UNSORTED_CONTAINER = "unsorted" as const;

// =============================================================================
// Individual Grocery DnD Types
// =============================================================================

/**
 * Container ID can be either a store ID or the UNSORTED_CONTAINER constant.
 */
export type ContainerId = string;

/**
 * Maps container IDs to arrays of grocery item IDs.
 * This represents the current visual order of items during drag operations.
 *
 * Example:
 * {
 *   'unsorted': ['grocery-1', 'grocery-2'],
 *   'store-abc-123': ['grocery-3', 'grocery-4', 'grocery-5']
 * }
 */
export type ItemsState = Record<ContainerId, string[]>;

/**
 * Context value provided by DndGroceryProvider.
 */
export interface DndGroceryContextValue {
  /** ID of the currently dragged item, or null if not dragging */
  activeId: string | null;

  /** The grocery DTO of the currently dragged item, or null if not dragging */
  activeGrocery: GroceryDto | null;

  /** Current container ID the dragged item is over */
  overContainerId: ContainerId | null;

  /**
   * Current items state - container ID to array of grocery IDs.
   * This updates during drag to reflect visual state.
   */
  items: ItemsState;

  /**
   * Get the ordered grocery IDs for a specific container.
   * Returns IDs in the current drag-adjusted order.
   */
  getItemsForContainer: (containerId: ContainerId) => string[];
}

/**
 * Props for the DndGroceryProvider component.
 */
export interface DndGroceryProviderProps {
  children: React.ReactNode;
  groceries: GroceryDto[];
  stores: StoreDto[];
  recurringGroceries: RecurringGroceryDto[];
  onReorderInStore: (updates: { id: string; sortOrder: number; storeId?: string | null }[]) => void;
  getRecipeNameForGrocery?: (grocery: GroceryDto) => string | null;
}

// =============================================================================
// Grouped Grocery DnD Types
// =============================================================================

/**
 * Maps container IDs to arrays of group keys.
 * This represents the current visual order of groups during drag operations.
 *
 * Example:
 * {
 *   'unsorted': ['unsorted|chicken|g', 'unsorted|onion|count'],
 *   'store-abc-123': ['store-abc-123|milk|ml', 'store-abc-123|eggs|count']
 * }
 */
export type GroupItemsState = Record<ContainerId, string[]>;

/**
 * Context value provided by DndGroupedGroceryProvider.
 */
export interface DndGroupedGroceryContextValue {
  /** Group key of the currently dragged group, or null if not dragging */
  activeGroupKey: string | null;

  /** The GroceryGroup being dragged, or null if not dragging */
  activeGroup: GroceryGroup | null;

  /** Current container ID the dragged group is over */
  overContainerId: ContainerId | null;

  /**
   * Current group items state - container ID to array of group keys.
   * This updates during drag to reflect visual state.
   */
  groupItems: GroupItemsState;

  /**
   * Get the ordered group keys for a specific container.
   * Returns keys in the current drag-adjusted order.
   */
  getGroupKeysForContainer: (containerId: ContainerId) => string[];
}

/**
 * Props for the DndGroupedGroceryProvider component.
 */
export interface DndGroupedGroceryProviderProps {
  children: React.ReactNode;
  stores: StoreDto[];
  recurringGroceries: RecurringGroceryDto[];
  /** Map of storeId -> GroceryGroup[] from groupGroceriesByIngredient */
  groupedGroceries: Map<string | null, GroceryGroup[]>;
  /** Called when groups are reordered - updates all groceries in the moved groups */
  onReorderGroups: (updates: { id: string; sortOrder: number; storeId?: string | null }[]) => void;
}
