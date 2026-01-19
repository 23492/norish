import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import RecipeCategories from "@/components/dashboard/recipe-categories";
import RecipeCard from "@/components/dashboard/recipe-card";
import { PermissionsProvider } from "@/context/permissions-context";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/permissions", () => ({
  usePermissionsQuery: () => ({
    data: {
      recipePolicy: {
        view: "everyone",
        edit: "everyone",
        delete: "everyone",
      },
      isAIEnabled: false,
      householdUserIds: null,
      isServerAdmin: false,
      autoTaggingMode: "disabled",
    },
    isLoading: false,
  }),
}));

vi.mock("@/context/user-context", () => ({
  useUserContext: () => ({
    user: { id: "user_1" },
  }),
}));

import type { RecipeDashboardDTO } from "@/types";
import type { RecipeCategory } from "@/types/dto/recipe";

function createRecipe(partial: Partial<RecipeDashboardDTO>): RecipeDashboardDTO {
  return {
    id: "recipe_1",
    name: "Pancakes",
    description: "Nice and fluffy",
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: null,
    url: null,
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    totalMinutes: 15,
    tags: [],
    categories: [],
    author: undefined,
    averageRating: null,
    calories: null,
    ratingCount: 0,
    ...partial,
  };
}

describe("RecipeCategories", () => {
  it("does not render when categories is empty", () => {
    const { container } = render(<RecipeCategories categories={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders each category as a chip", () => {
    const categories: RecipeCategory[] = ["Breakfast", "Dinner"];

    render(<RecipeCategories categories={categories} />);

    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
  });
});

describe("RecipeCard + RecipeCategories", () => {
  it("renders categories on the recipe card when present", () => {
    const recipe = createRecipe({ categories: ["Lunch"] });

    render(
      <PermissionsProvider>
        <RecipeCard
          allergies={[]}
          isFavorite={false}
          recipe={recipe}
          onDelete={() => undefined}
          onToggleFavorite={() => undefined}
        />
      </PermissionsProvider>
    );

    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });
});
