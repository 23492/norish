import type { UnitsMap } from "@/server/db/zodSchemas/server-config";

import { jsonrepair } from "jsonrepair";
import { parseIngredient } from "parse-ingredient";
import { decode } from "html-entities";

import { httpUrlSchema } from "./schema";

export function stripHtmlTags(input: string): string {
  const withoutTags = input.replace(/<[^>]*>/g, " ");

  return decode(withoutTags).trim().replace(/\s+/g, " ");
}

export const parseJsonWithRepair = (input: string): any | null => {
  try {
    const parsed = JSON.parse(input.trim());

    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const repaired = jsonrepair(input.trim());
    const reapairedParse = JSON.parse(repaired);

    if (reapairedParse) return reapairedParse;

    return [];
  }
};

export function parseIngredientWithDefaults(
  input: string | string[],
  units: UnitsMap = {}
): ReturnType<typeof parseIngredient> {
  const lines = Array.isArray(input) ? input : [input];
  const merged: any[] = [];

  for (const line of lines) {
    if (!line) continue;

    const normalizedLine = line.toString().replace(/(\d),(\d)/g, "$1.$2");
    let parsed = parseIngredient(normalizedLine, {
      additionalUOMs: units,
    });

    if (!parsed[0]?.quantity) {
      const allUnits = new Set<string>();

      for (const key in units) {
        const def = units[key];

        allUnits.add(key);
        if (def.short) allUnits.add(def.short);
        if (def.plural) allUnits.add(def.plural);
        if (def.alternates) def.alternates.forEach((a) => allUnits.add(a));
      }

      // Sort by length desc to match longest first
      const sortedUnits = Array.from(allUnits).sort((a, b) => b.length - a.length);
      const unitPattern = sortedUnits
        .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      const regex = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})\\b`, "i");

      const match = normalizedLine.match(regex);

      if (match) {
        const qty = match[1];
        const unit = match[2];
        const rest = normalizedLine.replace(match[0], "").trim().replace(/\s+/g, " ");
        const reordered = `${qty} ${unit} ${rest}`;

        const smartParsed = parseIngredient(reordered, {
          additionalUOMs: units,
        });

        if (smartParsed[0]?.quantity) {
          parsed = smartParsed;
        }
      }
    }

    merged.push(...parsed);
  }

  return merged as any;
}

export const parseIsoDuration = (iso: string): number | undefined => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(iso || "");

  if (!m) return undefined;

  const hours = m[1] ? parseInt(m[1]) : 0;
  const minutes = m[2] ? parseInt(m[2]) : 0;

  return hours * 60 + minutes;
};

export const formatMinutesHM = (mins?: number): string | undefined => {
  if (mins == null || mins < 0) return undefined;
  if (mins < 60) return `${mins}m`;

  const h = Math.floor(mins / 60);
  const m = mins % 60;

  return `${h}:${m.toString().padStart(2, "0")}h`;
};

export const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number = 300) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<F>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      func(...args);
    }, waitFor);
  };

  (debounced as typeof debounced & { cancel: () => void }).cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced as typeof debounced & { cancel: () => void };
};

export function isUrl(str: string): boolean {
  return httpUrlSchema.safeParse(str).success;
}

export const toArr = (v: any) => (Array.isArray(v) ? v : []);

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function addMonths(date: Date, amount: number): Date {
  const d = new Date(date);

  d.setMonth(d.getMonth() + amount);

  return d;
}

export function eachDayOfInterval(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start);

  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  return days;
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

/**
 * Normalize URL for consistent deduplication.
 * Removes trailing slashes, normalizes protocol, and strips tracking params.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove trailing slash from pathname
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");

    // Remove common tracking params
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    parsed.searchParams.delete("ref");
    parsed.searchParams.delete("fbclid");

    return parsed.toString().toLowerCase();
  } catch {
    // If URL parsing fails, just lowercase and trim
    return url.toLowerCase().trim();
  }
}

/**
 * Sort tags with allergy priority - allergens first, then rest in original order.
 *
 * @param tags - Array of tag objects with a name property
 * @param allergies - Array of allergy tag names to prioritize
 * @returns Sorted array of tags (allergens first in original order, then non-allergens in original order)
 */
export function sortTagsWithAllergyPriority<T extends { name: string }>(
  tags: T[],
  allergies: string[]
): T[] {
  const allergySet = new Set(allergies.map((a) => a.toLowerCase()));

  // Separate allergens and non-allergens while preserving original order
  const allergenTags: T[] = [];
  const nonAllergenTags: T[] = [];

  for (const tag of tags) {
    if (allergySet.has(tag.name.toLowerCase())) {
      allergenTags.push(tag);
    } else {
      nonAllergenTags.push(tag);
    }
  }

  // Allergens first, then non-allergens - both in their original order
  return [...allergenTags, ...nonAllergenTags];
}

/**
 * Check if a tag is an allergen (case-insensitive).
 *
 * @param tagName - The tag name to check
 * @param allergySet - Pre-computed Set of lowercase allergy names for O(1) lookup
 * @returns True if the tag is an allergen
 */
export function isAllergenTag(tagName: string, allergySet: Set<string>): boolean {
  return allergySet.has(tagName.toLowerCase());
}
