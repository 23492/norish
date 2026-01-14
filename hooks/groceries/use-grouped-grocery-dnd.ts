import type { GroceryGroup } from "@/lib/grocery-grouping";
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  CollisionDetection,
} from "@dnd-kit/core";
import type {
  GroupItemsState,
  ContainerId,
  DndGroupedGroceryProviderProps,
} from "@/components/groceries/dnd/types";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { arrayMove } from "@dnd-kit/sortable";

import {
  buildGroupItemsState,
  findContainerForGroup,
  containerIdToStoreId,
} from "@/components/groceries/dnd/utils";
import { createMultiContainerCollisionDetection } from "@/components/groceries/dnd/collision-detection";

interface UseGroupedGroceryDndResult {
  // State
  activeGroupKey: string | null;
  activeGroup: GroceryGroup | null;
  overContainerId: ContainerId | null;
  groupItems: GroupItemsState;

  // Collision detection
  collisionDetection: CollisionDetection;

  // Handlers
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;

  // Helpers
  getGroupKeysForContainer: (containerId: ContainerId) => string[];
}

export function useGroupedGroceryDnd({
  stores,
  groupedGroceries,
  onReorderGroups,
}: Omit<DndGroupedGroceryProviderProps, "children">): UseGroupedGroceryDndResult {
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [overContainerId, setOverContainerId] = useState<ContainerId | null>(null);

  // Group items state: container ID -> array of group keys
  // This updates during drag to reflect visual state
  const [groupItems, setGroupItems] = useState<GroupItemsState>(() =>
    buildGroupItemsState(groupedGroceries, stores)
  );

  // Clone of groupItems at drag start - used for cancel recovery
  const clonedGroupItems = useRef<GroupItemsState | null>(null);

  // Refs for stable collision detection (from reference implementation)
  const lastOverId = useRef<string | null>(null);
  const recentlyMovedToNewContainer = useRef(false);

  // Build a map of groupKey -> GroceryGroup for quick lookup
  const groupMap = useMemo(() => {
    const map = new Map<string, GroceryGroup>();

    for (const groups of groupedGroceries.values()) {
      for (const group of groups) {
        map.set(group.groupKey, group);
      }
    }

    return map;
  }, [groupedGroceries]);

  // Sync groupItems when groupedGroceries/stores change externally
  const prevGroupedGroceriesRef = useRef<Map<string | null, GroceryGroup[]>>(groupedGroceries);

  // Only rebuild if we're not actively dragging and groupedGroceries changed
  if (!activeGroupKey && groupedGroceries !== prevGroupedGroceriesRef.current) {
    prevGroupedGroceriesRef.current = groupedGroceries;
    const newGroupItems = buildGroupItemsState(groupedGroceries, stores);
    const itemsChanged =
      JSON.stringify(Object.keys(newGroupItems).sort()) !==
        JSON.stringify(Object.keys(groupItems).sort()) ||
      Object.keys(newGroupItems).some(
        (key) => JSON.stringify(newGroupItems[key]) !== JSON.stringify(groupItems[key])
      );

    if (itemsChanged) {
      setGroupItems(newGroupItems);
    }
  }

  // Reset recentlyMovedToNewContainer after groupItems state settles
  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false;
    });
  }, [groupItems]);

  const collisionDetection = useMemo(
    () =>
      createMultiContainerCollisionDetection(
        groupItems,
        activeGroupKey,
        lastOverId,
        recentlyMovedToNewContainer
      ),
    [groupItems, activeGroupKey]
  );

  const activeGroup = useMemo(() => {
    if (!activeGroupKey) return null;

    return groupMap.get(activeGroupKey) ?? null;
  }, [activeGroupKey, groupMap]);

  const getGroupKeysForContainer = useCallback(
    (containerId: ContainerId): string[] => {
      return groupItems[containerId] ?? [];
    },
    [groupItems]
  );

  const findContainer = useCallback(
    (id: string): ContainerId | undefined => {
      // Check if id is a container itself
      if (id in groupItems) {
        return id;
      }

      // Find which container has this group
      return Object.keys(groupItems).find((key) => groupItems[key].includes(id));
    },
    [groupItems]
  );

  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      const groupKey = active.id as string;

      setActiveGroupKey(groupKey);
      // Clone current groupItems for cancel recovery
      clonedGroupItems.current = JSON.parse(JSON.stringify(groupItems));

      const containerId = findContainerForGroup(groupKey, groupItems);

      setOverContainerId(containerId);
    },
    [groupItems]
  );

  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      const overId = over?.id;

      if (overId == null || active.id === overId) {
        return;
      }

      const overContainer = findContainer(overId as string);
      const activeContainer = findContainer(active.id as string);

      if (!overContainer || !activeContainer) {
        return;
      }

      setOverContainerId(overContainer);

      // Cross-container move
      if (activeContainer !== overContainer) {
        setGroupItems((prevItems) => {
          const activeItems = prevItems[activeContainer];
          const overItems = prevItems[overContainer];
          const overIndex = overItems.indexOf(overId as string);
          const activeIndex = activeItems.indexOf(active.id as string);

          let newIndex: number;

          // If dropping on container itself (not on an item)
          if (overId in prevItems) {
            newIndex = overItems.length;
          } else {
            // Determine if we're above or below the item we're hovering over
            const isBelowOverItem =
              over &&
              active.rect.current.translated &&
              active.rect.current.translated.top > over.rect.top + over.rect.height;

            const modifier = isBelowOverItem ? 1 : 0;

            newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length;
          }

          recentlyMovedToNewContainer.current = true;

          return {
            ...prevItems,
            [activeContainer]: prevItems[activeContainer].filter((key) => key !== active.id),
            [overContainer]: [
              ...prevItems[overContainer].slice(0, newIndex),
              activeItems[activeIndex],
              ...prevItems[overContainer].slice(newIndex),
            ],
          };
        });
      } else {
        // Same container reorder during drag
        setGroupItems((prevItems) => {
          const activeIndex = prevItems[activeContainer].indexOf(active.id as string);
          const overIndex = prevItems[overContainer].indexOf(overId as string);

          if (activeIndex !== overIndex) {
            return {
              ...prevItems,
              [overContainer]: arrayMove(prevItems[overContainer], activeIndex, overIndex),
            };
          }

          return prevItems;
        });
      }
    },
    [findContainer]
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const originalGroupItems = clonedGroupItems.current;
      const currentContainer = findContainer(active.id as string);

      if (!currentContainer) {
        setActiveGroupKey(null);
        setOverContainerId(null);
        clonedGroupItems.current = null;

        return;
      }

      const overId = over?.id;

      if (overId == null) {
        // No valid drop - restore original
        if (originalGroupItems) {
          setGroupItems(originalGroupItems);
        }
        setActiveGroupKey(null);
        setOverContainerId(null);
        clonedGroupItems.current = null;

        return;
      }

      // Build updates for backend based on current groupItems state
      // Each group contains multiple groceries - we need to update sortOrder for ALL of them
      if (originalGroupItems) {
        const originalContainer = findContainerForGroup(active.id as string, originalGroupItems);
        const wasCrossContainerMove = originalContainer !== currentContainer;
        const newStoreId = wasCrossContainerMove
          ? containerIdToStoreId(currentContainer)
          : undefined;

        const updates: { id: string; sortOrder: number; storeId?: string | null }[] = [];

        // Calculate the base sortOrder for each group position
        // Each group's items will be assigned sequential sortOrders starting from that base
        let sortOrderBase = 0;

        // Process all containers that were affected
        const containersToProcess = new Set<ContainerId>();

        containersToProcess.add(currentContainer);
        if (wasCrossContainerMove && originalContainer) {
          containersToProcess.add(originalContainer);
        }

        for (const containerId of containersToProcess) {
          const groupKeys = groupItems[containerId] ?? [];

          sortOrderBase = 0;

          for (const groupKey of groupKeys) {
            const group = groupMap.get(groupKey);

            if (!group) continue;

            // Update all groceries in this group with sequential sortOrders
            for (const source of group.sources) {
              const update: { id: string; sortOrder: number; storeId?: string | null } = {
                id: source.grocery.id,
                sortOrder: sortOrderBase++,
              };

              // If this is the moved group and it was a cross-container move, update storeId
              if (groupKey === active.id && wasCrossContainerMove) {
                update.storeId = newStoreId ?? null;
              }

              updates.push(update);
            }
          }
        }

        if (updates.length > 0) {
          onReorderGroups(updates);
        }
      }

      setActiveGroupKey(null);
      setOverContainerId(null);
      clonedGroupItems.current = null;
    },
    [findContainer, groupItems, groupMap, onReorderGroups]
  );

  const handleDragCancel = useCallback(() => {
    if (clonedGroupItems.current) {
      setGroupItems(clonedGroupItems.current);
    }
    setActiveGroupKey(null);
    setOverContainerId(null);
    clonedGroupItems.current = null;
  }, []);

  return {
    activeGroupKey,
    activeGroup,
    overContainerId,
    groupItems,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    getGroupKeysForContainer,
  };
}
