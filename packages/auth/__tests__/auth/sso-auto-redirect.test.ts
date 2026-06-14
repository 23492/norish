// @vitest-environment node
import type { ProviderInfo } from "@norish/shared/contracts";

import { describe, expect, it } from "vitest";

import { shouldAutoRedirectToSso } from "@norish/auth/providers";

/**
 * Unit tests for the SSO-only auto-redirect decision.
 *
 * This guards the WorkOS-only flow: the unauthenticated login/signup entry
 * point should jump straight to the hosted OAuth (AuthKit) page ONLY when a
 * single OAuth provider is the sole sign-in path, and must always fall back to
 * the normal login page when that is not true or when the user asks to escape
 * (`?sso=0`) — so a misconfig or an outage can never lock everyone out.
 */

const workos: ProviderInfo = {
  id: "workos",
  name: "WorkOS",
  icon: "logos:workos-icon",
  type: "oauth",
};

const google: ProviderInfo = {
  id: "google",
  name: "Google",
  icon: "flat-color-icons:google",
  type: "oauth",
};

const credential: ProviderInfo = {
  id: "credential",
  name: "Email",
  icon: "mdi:email-outline",
  type: "credential",
};

describe("shouldAutoRedirectToSso", () => {
  describe("sole OAuth provider (WorkOS-only)", () => {
    it("redirects when WorkOS is the only provider and password is off", () => {
      expect(shouldAutoRedirectToSso([workos])).toBe(true);
    });

    it("redirects for any single OAuth provider (not WorkOS-specific)", () => {
      expect(shouldAutoRedirectToSso([google])).toBe(true);
    });
  });

  describe("password auth still enabled", () => {
    it("does NOT redirect when an email/password provider is present", () => {
      // PASSWORD_AUTH_ENABLED=true surfaces a credential provider -> manual login.
      expect(shouldAutoRedirectToSso([workos, credential])).toBe(false);
    });
  });

  describe("WorkOS unset / no provider", () => {
    it("does NOT redirect when there are no providers at all", () => {
      // WorkOS env unset + password off -> nothing to redirect to; show the
      // 'no providers' login page rather than looping.
      expect(shouldAutoRedirectToSso([])).toBe(false);
    });

    it("does NOT redirect with only a credential provider (no OAuth)", () => {
      expect(shouldAutoRedirectToSso([credential])).toBe(false);
    });
  });

  describe("multiple OAuth providers", () => {
    it("does NOT redirect when more than one OAuth provider is configured", () => {
      // Ambiguous which to use -> render the chooser, never auto-pick.
      expect(shouldAutoRedirectToSso([workos, google])).toBe(false);
    });
  });

  describe("recovery escape (?sso=0 / logout)", () => {
    it("does NOT redirect when escape is requested, even with a sole OAuth provider", () => {
      expect(shouldAutoRedirectToSso([workos], true)).toBe(false);
    });

    it("redirects when escape is explicitly not requested", () => {
      expect(shouldAutoRedirectToSso([workos], false)).toBe(true);
    });
  });
});
