import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";

import { fetchRenderedHtml } from "@norish/api/camofox";

/**
 * Fetch the fully rendered HTML of a recipe page.
 *
 * The name is retained for API stability across its callers, but fetching now goes
 * through the Camoufox REST service instead of a Playwright CDP connection.
 *
 * Returns an empty string on failure or a hard block (`fetchRenderedHtml`
 * catches every internal error and resolves `""` rather than rejecting — see
 * `packages/api/src/camofox.ts`). Finding F-4: there is NO plain-HTTP
 * fallback anywhere in this codebase — `parseRecipeFromUrl` (`parser/index.ts`)
 * throws `Cannot fetch recipe page.` on an empty return. Reintroducing a
 * plain-HTTP path here would silently bypass Camoufox on bot-walled sites, a
 * CLAUDE.md fork-architecture violation, so this is a comment-only
 * correction, not a behaviour change.
 */
export async function fetchViaPlaywright(
  targetUrl: string,
  tokens?: SiteAuthTokenDecryptedDto[]
): Promise<string> {
  return fetchRenderedHtml(targetUrl, tokens);
}
