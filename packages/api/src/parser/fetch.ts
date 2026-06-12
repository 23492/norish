import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";

import { fetchRenderedHtml } from "@norish/api/camofox";

/**
 * Fetch the fully rendered HTML of a recipe page.
 *
 * The name is retained for API stability across its callers, but fetching now goes
 * through the Camoufox REST service instead of a Playwright CDP connection. Returns
 * an empty string on failure so callers can fall back to a plain HTTP fetch.
 */
export async function fetchViaPlaywright(
  targetUrl: string,
  tokens?: SiteAuthTokenDecryptedDto[]
): Promise<string> {
  return fetchRenderedHtml(targetUrl, tokens);
}
