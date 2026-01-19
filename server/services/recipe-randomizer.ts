import type { RandomRecipeCandidate } from "@/server/db/repositories/recipes";

export function calculateWeight(candidate: RandomRecipeCandidate): number {
  let weight = 1.0;

  const favoriteBonus = Math.min(candidate.householdFavoriteCount * 0.2, 1.0);
  weight += favoriteBonus;

  if (candidate.householdAverageRating !== null && candidate.householdAverageRating < 3) {
    weight *= 0.7;
  }

  return Math.max(weight, 0.1);
}

export function selectWeightedRandomRecipe(
  candidates: RandomRecipeCandidate[]
): RandomRecipeCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const weights = candidates.map(calculateWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  let random = Math.random() * totalWeight;

  for (let i = 0; i < candidates.length; i++) {
    random -= weights[i];

    if (random <= 0) {
      return candidates[i];
    }
  }

  return candidates[candidates.length - 1];
}
