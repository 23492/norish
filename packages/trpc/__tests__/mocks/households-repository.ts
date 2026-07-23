/**
 * Mock for @norish/db/repositories/households
 *
 * Provides getUserHouseholdIds (called by withAuth middleware to populate
 * ctx.memberHouseholdIds) and other household repo functions used in tests.
 */
import { vi } from "vitest";

export const getUserHouseholdIds = vi.fn(() => Promise.resolve([] as string[]));
export const getHouseholdForUser = vi.fn(() => Promise.resolve(null));
export const getHouseholdPolicy = vi.fn(() => Promise.resolve(null));
// SHOP-02: fallback resolver for the personal-view shopping household.
export const getOwnHouseholdId = vi.fn(() => Promise.resolve(null as string | null));
