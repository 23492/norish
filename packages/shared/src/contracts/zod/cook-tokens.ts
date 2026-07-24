import z from "zod";

/**
 * Cooklang read-model tokens (Phase 27, W1 — additive, un-wired).
 *
 * A `.cook` source is parsed server-side (`@norish/shared-server/cooklang/parse`)
 * and projected into this shape so clients can render a step without ever running
 * the WASM parser. Everything here is PLAIN JSON: no class instances and no parser
 * indices — the parser's `{ type: "ingredient", index }` items are dereferenced
 * before they reach this contract, so the projection survives superjson/tRPC.
 *
 * `unit` is always the CANONICAL norish unit ID (`gram`, `tablespoon`) per D-8,
 * never a localized label; rendering goes through `formatUnit` on the client.
 */

export const CookTextTokenSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
});

export const CookIngredientTokenSchema = z.object({
  type: z.literal("ingredient"),
  name: z.string(),
  amount: z.number().nullable(),
  unit: z.string().nullable(),
});

export const CookTimerTokenSchema = z.object({
  type: z.literal("timer"),
  name: z.string().nullable(),
  amount: z.number().nullable(),
  unit: z.string().nullable(),
});

export const CookTokenSchema = z.discriminatedUnion("type", [
  CookTextTokenSchema,
  CookIngredientTokenSchema,
  CookTimerTokenSchema,
]);

export const CookStepTokensSchema = z.object({
  order: z.coerce.number(),
  /** `== Heading ==` section this step belongs to, or `null` for the anonymous section. */
  section: z.string().nullable().default(null),
  tokens: z.array(CookTokenSchema).default([]),
});

export const CookTokensSchema = z.array(CookStepTokensSchema);
