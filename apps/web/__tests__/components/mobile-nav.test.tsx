import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import { MobileNav } from "@/components/navbar/mobile-nav";

// The logged-in user's display name. The mobile bottom-nav profile pill must
// NOT render this anywhere — only the avatar (NavbarUserMenu) is shown there.
const USER_NAME = "Kiran Knoppert";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// AnimatePresence + motion.div are used by MobileNav; render them as plain DOM,
// stripping motion-only props so they aren't forwarded as DOM attributes.
vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...props }: any) => (
      <div {...props}>{children}</div>
    ),
  },
}));

// Force the bar visible so its contents are in the DOM.
vi.mock("@/hooks/auto-hide", () => ({
  useAutoHide: () => ({ isVisible: true, show: vi.fn() }),
}));

vi.mock("@/context/user-context", () => ({
  useUserContext: () => ({
    user: { name: USER_NAME, email: "kiran@example.com", image: null },
    userMenuOpen: false,
    setUserMenuOpen: vi.fn(),
  }),
}));

// The shared profile/account control. In the real app it renders the avatar
// (a button) that opens the menu; here we stub it to a labelled avatar button
// WITHOUT any visible name text, mirroring the production avatar trigger.
vi.mock("@/components/navbar/navbar-user-menu", () => ({
  default: () => (
    <button aria-label="Open user menu" type="button">
      <span data-testid="avatar" />
    </button>
  ),
}));

describe("MobileNav bottom bar", () => {
  it("renders the profile avatar/tap-target but not the user's name", () => {
    render(<MobileNav />);

    // Tap target + avatar are present (the item stays tappable -> opens menu).
    expect(screen.getByRole("button", { name: "Open user menu" })).toBeInTheDocument();
    expect(screen.getByTestId("avatar")).toBeInTheDocument();

    // The user's name must NOT be visible in the bottom bar.
    expect(screen.queryByText(USER_NAME)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(USER_NAME, "i"))).not.toBeInTheDocument();
  });

  it("still renders the primary nav items", () => {
    render(<MobileNav />);

    // siteConfig.navItems -> translation keys home/groceries/calendar/cookbooks (mocked 1:1).
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByText("groceries")).toBeInTheDocument();
    expect(screen.getByText("calendar")).toBeInTheDocument();
    expect(screen.getByText("cookbooks")).toBeInTheDocument();
  });
});
