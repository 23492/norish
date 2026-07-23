/**
 * Recipe Import Progress — IMPORT-UX-01
 *
 * A single, cookbook-scoped emit site for a running import's honest stage transitions
 * (fetching → saving). It is deliberately a thin wrapper over `emitByPolicy` so the
 * worker resolves the realtime scope ONCE (via `resolveHouseholdRealtimeScope`, keyed on
 * the import's TARGET cookbook) and reuses it here.
 *
 * REALTIME-ISO-01 / HOUSE-06: progress is a resource-bearing push. It MUST stay at the
 * cookbook boundary and MUST NEVER reach `emitter.broadcast()`. Under the production
 * default `recipe_permission_policy.view = "everyone"`, broadcasting here would show one
 * household's import progress to every connected client — the exact leak Phase 22 closed.
 * `emitByPolicy` clamps `everyone` to the household channel; do not route around it.
 */
import type { RecipeRealtimeScope } from "@norish/shared-server/realtime/policy";
import type { RecipeImportStage } from "@norish/shared/contracts";
import { emitByPolicy } from "@norish/shared-server/realtime/policy";
import { recipeEmitter } from "@norish/shared-server/realtime/recipes";

export function emitImportProgress(
  scope: RecipeRealtimeScope,
  payload: { recipeId: string; url?: string; stage: RecipeImportStage }
): void {
  emitByPolicy(recipeEmitter, scope.viewPolicy, scope.ctx, "importProgress", payload);
}
