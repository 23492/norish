/**
 * DINNER-01 — "What's for dinner?" suggestion scoring.
 *
 * A PURE, deterministic ranking layer over the ALREADY-SCOPED candidate set
 * produced by `getDinnerSuggestionCandidates` (packages/db recipes repo), which
 * reuses `buildViewPolicyCondition` wholesale — so the per-cookbook isolation
 * boundary is inherited here, never re-derived. This module NEVER queries the
 * database and NEVER reads recipe names/ratings the candidate query did not
 * already scope; it only re-orders what it is handed.
 *
 * It weighs two signals, both drawn from the shipped surface (no new data
 * source, no new provider):
 *   - SEASON — derived from the recipe's OWN tags (the existing tags surface)
 *     matched against a bilingual (EN + NL) seasonal lexicon; the current season
 *     is derived from the supplied date.
 *   - RECENT RATINGS — the shipped `recipe_ratings` aggregate (household-scoped
 *     average + count) plus how recently the recipe was last rated.
 *
 * Determinism: the ranking is a pure function of (candidates, now, count). A
 * small per-day jitter seeded from `hash(recipeId + dateKey)` rotates otherwise
 * tied recipes day-to-day (so the suggestion feels alive) without introducing
 * `Math.random()` — the same inputs always yield the same order, which is what
 * the tests pin.
 */

export interface DinnerCandidate {
  id: string;
  name: string;
  image: string | null;
  /** The recipe's own tag names (already scoped by the candidate query). */
  tags: string[];
  /** Household-scoped average rating (mirrors getRandomRecipeCandidates). */
  householdAverageRating: number | null;
  /** Household-scoped number of ratings. */
  householdRatingCount: number;
  /** Most recent household rating timestamp, or null if never rated. */
  lastRatedAt: Date | null;
}

export type Season = "spring" | "summer" | "autumn" | "winter";

export interface DinnerSuggestion {
  id: string;
  name: string;
  image: string | null;
  tags: string[];
  averageRating: number | null;
  ratingCount: number;
  /** Whether any of the recipe's tags matched the current season's lexicon. */
  matchesSeason: boolean;
  /** The season the suggestion was ranked for (so the UI can label it). */
  season: Season;
}

export interface SelectDinnerOptions {
  /** The moment the suggestion is made — season + recency are derived from it. */
  now: Date;
  /** How many suggestions to return (headline + alternates). */
  count?: number;
}

/**
 * Bilingual (EN + NL) seasonal keyword lexicon. Matched as case-insensitive
 * substrings against a recipe's tag names, so "pumpkin soup" matches "pumpkin".
 * Keeping it here (not in a table) keeps the season signal derived ENTIRELY from
 * the existing tags surface — no new data source.
 */
const SEASON_KEYWORDS: Record<Season, readonly string[]> = {
  spring: [
    "spring",
    "lente",
    "asparagus",
    "asperge",
    "rhubarb",
    "rabarber",
    "pea",
    "erwt",
    "easter",
    "pasen",
  ],
  summer: [
    "summer",
    "zomer",
    "bbq",
    "barbecue",
    "grill",
    "salad",
    "salade",
    "ice cream",
    "ijs",
    "picnic",
    "picknick",
    "refreshing",
    "fris",
  ],
  autumn: [
    "autumn",
    "fall",
    "herfst",
    "pumpkin",
    "pompoen",
    "squash",
    "mushroom",
    "paddenstoel",
    "apple",
    "appel",
    "harvest",
    "oogst",
    "stew",
    "stoof",
  ],
  winter: [
    "winter",
    "stew",
    "stoof",
    "soup",
    "soep",
    "stamppot",
    "hutspot",
    "roast",
    "braise",
    "oven",
    "comfort",
    "hearty",
    "stevig",
    "christmas",
    "kerst",
  ],
};

const SEASON_BONUS = 1.5;
const RECENCY_WINDOW_DAYS = 30;
const RECENCY_BONUS = 0.8;
const RATING_COUNT_CAP = 0.5;
const JITTER_MAX = 0.25;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Northern-hemisphere meteorological seasons (norish's primary audience is NL).
 * Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn.
 */
export function deriveSeason(date: Date): Season {
  const month = date.getMonth(); // 0 = Jan

  if (month <= 1 || month === 11) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";

  return "autumn";
}

/** True when any of the recipe's tag names matches the season's lexicon. */
export function matchesSeason(tags: readonly string[], season: Season): boolean {
  const keywords = SEASON_KEYWORDS[season];

  return tags.some((tag) => {
    const normalized = tag.toLowerCase();

    return keywords.some((keyword) => normalized.includes(keyword));
  });
}

/** Stable, deterministic hash of a recipe id + day, normalized to [0, 1). */
function dailyJitter(id: string, dayKey: string): number {
  const seed = `${id}:${dayKey}`;
  let hash = 5381;

  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0; // djb2, wrapped to int32
  }

  // Map the signed int32 into [0, 1) then scale to the jitter band.
  return ((hash >>> 0) / 0xffffffff) * JITTER_MAX;
}

/** UTC day key (YYYY-MM-DD) used to seed the per-day jitter. */
function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Score a single candidate. Higher is better; the floor keeps every candidate
 * eligible so the suggester never returns empty when candidates exist.
 */
export function scoreDinnerCandidate(
  candidate: DinnerCandidate,
  season: Season,
  now: Date
): number {
  let score = 1.0;

  if (matchesSeason(candidate.tags, season)) {
    score += SEASON_BONUS;
  }

  const avg = candidate.householdAverageRating;

  if (avg !== null) {
    // Favour highly-rated recipes and gently penalise poorly-rated ones:
    // avg 5 -> +1.0, avg 3 -> 0, avg 1 -> -1.0.
    score += (avg - 3) * 0.5;
    // A little extra confidence for recipes rated more than once.
    score += Math.min(candidate.householdRatingCount * 0.1, RATING_COUNT_CAP);
  }

  if (candidate.lastRatedAt) {
    const days = (now.getTime() - candidate.lastRatedAt.getTime()) / MS_PER_DAY;

    if (days >= 0 && days <= RECENCY_WINDOW_DAYS) {
      score += RECENCY_BONUS * (1 - days / RECENCY_WINDOW_DAYS);
    }
  }

  score += dailyJitter(candidate.id, dayKeyOf(now));

  return Math.max(score, 0.05);
}

/**
 * Rank the scoped candidates and return the top `count`. Pure and deterministic
 * for a given (candidates, now, count): ties break by id so the order is total.
 */
export function selectDinnerSuggestions(
  candidates: DinnerCandidate[],
  { now, count = 3 }: SelectDinnerOptions
): DinnerSuggestion[] {
  if (candidates.length === 0) return [];

  const season = deriveSeason(now);

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreDinnerCandidate(candidate, season, now),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      return a.candidate.id < b.candidate.id ? -1 : 1;
    });

  return ranked.slice(0, Math.max(count, 0)).map(({ candidate }) => ({
    id: candidate.id,
    name: candidate.name,
    image: candidate.image,
    tags: candidate.tags,
    averageRating: candidate.householdAverageRating,
    ratingCount: candidate.householdRatingCount,
    matchesSeason: matchesSeason(candidate.tags, season),
    season,
  }));
}
