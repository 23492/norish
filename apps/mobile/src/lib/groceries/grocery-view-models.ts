import type { GroceryDto, RecurringGroceryDto, StoreDto } from "@norish/shared/contracts";
import type { RecipeMap } from "@norish/shared-react/hooks";

export type GroceryViewMode = "store" | "recipe";

export type GroceryStore = {
  id: string;
  name: string;
  subtitle: string;
  tintColor: string;
};

export type GroceryItem = {
  id: string;
  name: string;
  amount: string;
  note?: string;
  completed: boolean;
  recurring?: boolean;
  /** Unix ms timestamp of the last completed/uncompleted toggle. Used for sort ordering. */
  toggledAt?: number;
  /** Manual sort position within a section. Lower values appear first. */
  sortOrder?: number;
  storeId?: string;
  recipeId?: string;
  version?: number;
  recurringGroceryId?: string;
  recurringVersion?: number;
};

export type GroceryRowModel = GroceryItem & {
  contextLabel?: string;
  recurring?: boolean;
};

export type GrocerySectionModel = {
  id: string;
  title: string;
  tintColor: string;
  items: GroceryRowModel[];
};

const UNSORTED_STORE: GroceryStore = {
  id: "unsorted",
  name: "Unsorted",
  subtitle: "No store assigned",
  tintColor: "#8B5CF6",
};

const STORE_COLOR_TINTS: Record<string, string> = {
  primary: "#0EA5E9",
  secondary: "#8B5CF6",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#FB7185",
  slate: "#64748B",
  sky: "#0EA5E9",
  violet: "#8B5CF6",
};

function formatAmount(amount: number | null, unit: string | null): string {
  if (amount == null && !unit) return "1";
  if (amount == null) return unit ?? "1";

  const formattedAmount = Number.isInteger(amount) ? String(amount) : String(amount).replace(/0+$/, "").replace(/\.$/, "");

  return [formattedAmount, unit].filter(Boolean).join(" ");
}

function storeTintColor(store: StoreDto): string {
  return STORE_COLOR_TINTS[store.color] ?? STORE_COLOR_TINTS.primary;
}

export function mapStoresToGroceryStores(stores: StoreDto[]): GroceryStore[] {
  return [
    UNSORTED_STORE,
    ...stores
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((store) => ({
        id: store.id,
        name: store.name,
        subtitle: "Store",
        tintColor: storeTintColor(store),
      })),
  ];
}

export function mapGroceriesToRows({
  groceries,
  recurringGroceries,
  recipeMap,
}: {
  groceries: GroceryDto[];
  recurringGroceries: RecurringGroceryDto[];
  recipeMap: RecipeMap;
}): GroceryRowModel[] {
  const recurringById = new Map(recurringGroceries.map((recurring) => [recurring.id, recurring]));

  return groceries.map((grocery) => {
    const recipeInfo = grocery.recipeIngredientId ? recipeMap[grocery.recipeIngredientId] : null;
    const recurring = grocery.recurringGroceryId
      ? recurringById.get(grocery.recurringGroceryId)
      : null;

    return {
      id: grocery.id,
      name: grocery.name?.trim() || "Grocery",
      amount: formatAmount(grocery.amount, grocery.unit),
      completed: grocery.isDone,
      sortOrder: grocery.sortOrder,
      storeId: grocery.storeId ?? undefined,
      recipeId: recipeInfo?.recipeId,
      recurring: !!recurring,
      recurringGroceryId: recurring?.id,
      recurringVersion: recurring?.version,
      version: grocery.version,
    };
  });
}

/**
 * Pending items first, completed items at the bottom.
 * Items in `frozenIds` are treated as not-yet-completed so their position stays pinned.
 */
function sortByCompletion(
  items: GroceryRowModel[],
  frozenIds: ReadonlySet<string> = new Set()
): GroceryRowModel[] {
  return [...items].sort((a, b) => {
    const aDone = a.completed && !frozenIds.has(a.id);
    const bDone = b.completed && !frozenIds.has(b.id);

    if (aDone !== bDone) return Number(aDone) - Number(bDone);

    if (aDone) {
      const aTime = a.toggledAt ?? 0;
      const bTime = b.toggledAt ?? 0;
      return bTime - aTime;
    }

    const aOrder = a.sortOrder ?? Infinity;
    const bOrder = b.sortOrder ?? Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;

    const aTime = a.toggledAt ?? 0;
    const bTime = b.toggledAt ?? 0;
    return aTime - bTime;
  });
}

/** Split a section's items into sortable (uncompleted) and done (completed) arrays. */
export function splitSectionItems(
  items: GroceryRowModel[],
  frozenIds: ReadonlySet<string> = new Set()
): { sortableItems: GroceryRowModel[]; doneItems: GroceryRowModel[] } {
  const sortableItems: GroceryRowModel[] = [];
  const doneItems: GroceryRowModel[] = [];

  for (const item of items) {
    if (item.completed && !frozenIds.has(item.id)) {
      doneItems.push(item);
    } else {
      sortableItems.push(item);
    }
  }

  return { sortableItems, doneItems };
}

export function buildStoreSections({
  items,
  stores,
  recipeMap,
  frozenIds = new Set(),
}: {
  items: GroceryItem[];
  stores: GroceryStore[];
  recipeMap: RecipeMap;
  frozenIds?: ReadonlySet<string>;
}): GrocerySectionModel[] {
  const recipeNameById = new Map(Object.values(recipeMap).map((recipe) => [recipe.recipeId, recipe.recipeName]));
  const sections: GrocerySectionModel[] = [];

  for (const store of stores) {
    const storeItems = items
      .filter((item) => (store.id === UNSORTED_STORE.id ? item.storeId == null : item.storeId === store.id))
      .map((item) => ({
        ...item,
        contextLabel: item.recipeId ? recipeNameById.get(item.recipeId) : undefined,
      }));

    if (storeItems.length === 0) continue;

    sections.push({
      id: store.id,
      title: store.name,
      tintColor: store.tintColor,
      items: sortByCompletion(storeItems, frozenIds),
    });
  }

  return sections;
}

export function buildRecipeSections({
  items,
  stores,
  recipeMap,
  frozenIds = new Set(),
}: {
  items: GroceryItem[];
  stores: GroceryStore[];
  recipeMap: RecipeMap;
  frozenIds?: ReadonlySet<string>;
}): GrocerySectionModel[] {
  const storeMap = new Map(stores.map((store) => [store.id, store]));
  const recipeEntries = Object.values(recipeMap).sort((a, b) => a.recipeName.localeCompare(b.recipeName));
  const sections: GrocerySectionModel[] = [];

  for (const recipe of recipeEntries) {
    const recipeItems = items
      .filter((item) => item.recipeId === recipe.recipeId)
      .map((item) => ({
        ...item,
        contextLabel: item.storeId ? storeMap.get(item.storeId)?.name : UNSORTED_STORE.name,
      }));

    if (recipeItems.length === 0) continue;

    sections.push({
      id: recipe.recipeId,
      title: recipe.recipeName,
      tintColor: "#0EA5E9",
      items: sortByCompletion(recipeItems, frozenIds),
    });
  }

  const uncategorizedItems = items
    .filter((item) => item.recipeId == null)
    .map((item) => ({
      ...item,
      contextLabel: item.storeId ? storeMap.get(item.storeId)?.name : UNSORTED_STORE.name,
    }));

  if (uncategorizedItems.length > 0) {
    sections.push({
      id: "recipe-free",
      title: "Just groceries",
      tintColor: "#A855F7",
      items: sortByCompletion(uncategorizedItems, frozenIds),
    });
  }

  return sections;
}
