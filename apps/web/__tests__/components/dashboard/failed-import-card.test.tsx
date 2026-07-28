import FailedImportCard from "@/components/dashboard/failed-import-card";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "common.import.failure.title": "Import failed",
      "common.import.failure.fallbackReason": "This recipe could not be imported.",
      "common.import.failure.source": "Source: {host}",
      "common.import.failure.dismiss": "Dismiss",
    };
    const template = messages[namespace ? `${namespace}.${key}` : key] ?? key;

    if (!values) return template;

    return Object.entries(values).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      template
    );
  },
}));

vi.mock("@heroui/react", () => ({
  Button: ({ children, onPress, ...props }: any) => (
    <button type="button" onClick={onPress} {...props}>
      {children}
    </button>
  ),
  Card: Object.assign(({ children, ...props }: any) => <article {...props}>{children}</article>, {
    Content: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  }),
}));

describe("FailedImportCard", () => {
  it("renders the failure reason, the source host, and a dismiss control (grid variant)", () => {
    const onDismiss = vi.fn();

    render(
      <FailedImportCard
        recipeId="recipe-1"
        reason="AI extraction failed"
        url="https://example.com/recipe/1"
        variant="grid"
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText("Import failed")).toBeInTheDocument();
    expect(screen.getByText("AI extraction failed")).toBeInTheDocument();
    expect(screen.getByText("Source: example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("renders in the list variant with the same content", () => {
    render(
      <FailedImportCard
        recipeId="recipe-2"
        reason="Failed to parse recipe from URL"
        url="https://lekker.nl/recept/1"
        variant="list"
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("Import failed")).toBeInTheDocument();
    expect(screen.getByText("Failed to parse recipe from URL")).toBeInTheDocument();
    expect(screen.getByText("Source: lekker.nl")).toBeInTheDocument();
  });

  it("falls back to a translated description when the server sends no reason", () => {
    render(
      <FailedImportCard recipeId="recipe-3" reason="" variant="grid" onDismiss={vi.fn()} />
    );

    expect(screen.getByText("This recipe could not be imported.")).toBeInTheDocument();
  });

  it("renders no source line when no url is present", () => {
    render(
      <FailedImportCard recipeId="recipe-4" reason="boom" variant="grid" onDismiss={vi.fn()} />
    );

    expect(screen.queryByText(/^Source:/)).not.toBeInTheDocument();
  });

  it("calls onDismiss with the recipe id when the dismiss control is pressed, and the card unmounts on removal", () => {
    const onDismiss = vi.fn();

    const { rerender } = render(
      <FailedImportCard
        recipeId="recipe-5"
        reason="boom"
        url="https://example.com/x"
        variant="grid"
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledWith("recipe-5");

    // Simulate the parent removing the entry from `failedImports` after dismiss.
    rerender(<></>);

    expect(screen.queryByText("Import failed")).not.toBeInTheDocument();
  });
});
