export type GroceryViewMode = "store" | "recipe";

export type GroceryStore = {
  id: string;
  name: string;
  subtitle: string;
  tintColor: string;
};

export type GroceryRecipe = {
  id: string;
  title: string;
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

const STORES: GroceryStore[] = [
  {
    id: "unsorted",
    name: "Unsorted",
    subtitle: "Quick grabs and pantry fills",
    tintColor: "#8B5CF6",
  },
  {
    id: "whole-foods",
    name: "Whole Foods",
    subtitle: "Produce, dairy, and seafood",
    tintColor: "#22C55E",
  },
  {
    id: "h-mart",
    name: "H Mart",
    subtitle: "Sauces, rice, and aromatics",
    tintColor: "#FB7185",
  },
  {
    id: "farmers-market",
    name: "Farmers' Market",
    subtitle: "Weekend produce run",
    tintColor: "#F59E0B",
  },
];

const RECIPES: GroceryRecipe[] = [
  {
    id: "salmon-bowls",
    title: "Crispy Miso Salmon Bowls",
    subtitle: "Tuesday dinner",
    tintColor: "#0EA5E9",
  },
  {
    id: "peach-salad",
    title: "Peach Halloumi Salad",
    subtitle: "Thursday lunch",
    tintColor: "#F97316",
  },
  {
    id: "latte-prep",
    title: "Morning Matcha Prep",
    subtitle: "Daily ritual",
    tintColor: "#10B981",
  },
];

const ITEMS: GroceryItem[] = [
  {
    id: "grocery-1",
    name: "Meyer lemons",
    amount: "4 ct",
    completed: false,
    storeId: "whole-foods",
    recipeId: "salmon-bowls",
  },
  {
    id: "grocery-2",
    name: "Greek yogurt",
    amount: "24 oz",
    completed: false,
    recurring: true,
    storeId: "whole-foods",
    recipeId: "latte-prep",
  },
  {
    id: "grocery-3",
    name: "Gochujang",
    amount: "1 jar",
    completed: false,
    storeId: "h-mart",
    recipeId: "salmon-bowls",
  },
  {
    id: "grocery-4",
    name: "Short-grain rice",
    amount: "5 lb",
    completed: true,
    recurring: true,
    storeId: "h-mart",
    recipeId: "salmon-bowls",
  },
  {
    id: "grocery-5",
    name: "Shiso leaves",
    amount: "1 bunch",
    completed: false,
    storeId: "farmers-market",
    recipeId: "peach-salad",
  },
  {
    id: "grocery-6",
    name: "White peaches",
    amount: "6 ct",
    completed: false,
    storeId: "farmers-market",
    recipeId: "peach-salad",
  },
  {
    id: "grocery-7",
    name: "Flaky sea salt",
    amount: "1 tin",
    completed: true,
  },
  {
    id: "grocery-8",
    name: "Sparkling water",
    amount: "8 cans",
    completed: false,
    recurring: true,
  },
  {
    id: "grocery-9",
    name: "Scallions",
    amount: "2 bunches",
    completed: false,
    storeId: "h-mart",
    recipeId: "salmon-bowls",
  },
  {
    id: "grocery-10",
    name: "Halloumi",
    amount: "2 blocks",
    completed: false,
    storeId: "whole-foods",
    recipeId: "peach-salad",
  },
];

export function createMockGroceries(): GroceryItem[] {
  return ITEMS.map((item) => ({ ...item }));
}

export function getGroceriesSummary(items: GroceryItem[]) {
  const storeCount = new Set(items.flatMap((item) => (item.storeId ? [item.storeId] : []))).size;
  const recipeCount = new Set(items.flatMap((item) => (item.recipeId ? [item.recipeId] : []))).size;
  const completedCount = items.filter((item) => item.completed).length;

  return {
    itemCount: items.length,
    storeCount,
    recipeCount,
    completedCount,
  };
}

/**
 * Pending items first, completed items at the bottom.
 *
 * Undone group ordering priority:
 *   1. `sortOrder` (manual drag-and-drop position) — lower values first.
 *   2. `toggledAt` — most recently unticked goes to the bottom.
 *   3. Original array order (stable sort).
 *
 * Done group ordering:
 *   - Most recently ticked → top of the done group.
 *
 * Items in `frozenIds` are treated as not-yet-completed so their position
 * stays pinned while the completion animation plays out.
 */
function sortByCompletion(
  items: GroceryRowModel[],
  frozenIds: ReadonlySet<string> = new Set()
): GroceryRowModel[] {
  return [...items].sort((a, b) => {
    const aDone = a.completed && !frozenIds.has(a.id);
    const bDone = b.completed && !frozenIds.has(b.id);

    // Split into done vs undone first.
    if (aDone !== bDone) return Number(aDone) - Number(bDone);

    if (aDone) {
      // Done group: most recently ticked goes to the top (descending time).
      const aTime = a.toggledAt ?? 0;
      const bTime = b.toggledAt ?? 0;
      return bTime - aTime;
    }

    // Undone group: prefer manual sortOrder, fall back to toggledAt.
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

export function buildStoreSections(
  items: GroceryItem[],
  frozenIds: ReadonlySet<string> = new Set()
): GrocerySectionModel[] {
  const storeMap = new Map(STORES.map((store) => [store.id, store]));
  const recipeMap = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));
  const sections: GrocerySectionModel[] = [];

  const unsortedItems = items.filter((item) => item.storeId == null).map((item) => ({
    ...item,
    contextLabel: item.recipeId ? recipeMap.get(item.recipeId)?.title : undefined,
  }));

  if (unsortedItems.length > 0) {
    const unsortedStore = storeMap.get("unsorted");

    if (unsortedStore) {
      sections.push({
        id: unsortedStore.id,
        title: unsortedStore.name,
        tintColor: unsortedStore.tintColor,
        items: sortByCompletion(unsortedItems, frozenIds),
      });
    }
  }

  for (const store of STORES.filter((entry) => entry.id !== "unsorted")) {
    const storeItems = items.filter((item) => item.storeId === store.id).map((item) => ({
      ...item,
      contextLabel: item.recipeId ? recipeMap.get(item.recipeId)?.title : undefined,
    }));

    if (storeItems.length === 0) {
      continue;
    }

    sections.push({
      id: store.id,
      title: store.name,
      tintColor: store.tintColor,
      items: sortByCompletion(storeItems, frozenIds),
    });
  }

  return sections;
}

export function buildRecipeSections(
  items: GroceryItem[],
  frozenIds: ReadonlySet<string> = new Set()
): GrocerySectionModel[] {
  const storeMap = new Map(STORES.map((store) => [store.id, store]));
  const sections: GrocerySectionModel[] = [];

  for (const recipe of RECIPES) {
    const recipeItems = items.filter((item) => item.recipeId === recipe.id).map((item) => ({
      ...item,
      contextLabel: item.storeId ? storeMap.get(item.storeId)?.name : "Unsorted",
    }));

    if (recipeItems.length === 0) {
      continue;
    }

    sections.push({
      id: recipe.id,
      title: recipe.title,
      tintColor: recipe.tintColor,
      items: sortByCompletion(recipeItems, frozenIds),
    });
  }

  const uncategorizedItems = items.filter((item) => item.recipeId == null).map((item) => ({
    ...item,
    contextLabel: item.storeId ? storeMap.get(item.storeId)?.name : "Unsorted",
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
