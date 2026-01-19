"use client";

import { Chip } from "@heroui/react";

import type { RecipeCategory } from "@/types/dto/recipe";

export default function RecipeCategories({ categories }: { categories: RecipeCategory[] }) {
  if (categories.length === 0) return null;

  return (
    <div className="scrollbar-hide flex gap-1 overflow-x-auto">
      {categories.map((category) => (
        <Chip key={category} className="bg-primary-100 text-primary-700" size="sm" variant="flat">
          {category}
        </Chip>
      ))}
    </div>
  );
}
