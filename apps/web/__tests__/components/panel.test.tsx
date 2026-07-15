import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom";

import Panel from "@/components/Panel/Panel";

// Panel now renders on the free @heroui/react Drawer (react-aria overlay). When
// open, the dialog + its content portal into the document; we assert the shared
// height cap, backdrop variant, and body classes on the real rendered nodes.
describe("Panel", () => {
  it("uses the shared 80dvh height cap and blur backdrop by default", () => {
    render(
      <Panel open title="Filters" onOpenChange={vi.fn()}>
        <Panel.Body>Filter controls</Panel.Body>
        <Panel.Footer>
          <button type="button">Apply</button>
        </Panel.Footer>
      </Panel>
    );

    const dialog = screen.getByRole("dialog", { name: "Filters" });

    expect(dialog).toHaveClass("max-h-[80dvh]");
    expect(dialog).toHaveClass("min-h-0");
    expect(screen.getByText("Filter controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();

    // Default blur backdrop: the modal overlay carries the pinned z-index class.
    const backdrop = document.querySelector(".z-\\[1000\\]");

    expect(backdrop).not.toBeNull();
  });

  it("does not render dialog content while closed", () => {
    render(
      <Panel title="Calendar" onOpenChange={vi.fn()}>
        <Panel.Body>Calendar controls</Panel.Body>
      </Panel>
    );

    expect(screen.queryByRole("dialog", { name: "Calendar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Calendar controls")).not.toBeInTheDocument();
  });
});
