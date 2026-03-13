import { observable, observableToPromise } from "@trpc/server/observable";
import { describe, expect, it, vi } from "vitest";

import { createMutationGuardLink } from "./trpc-provider";

describe("createMutationGuardLink", () => {
  it("blocks mutations when the guard returns false", async () => {
    const next = vi.fn();
    const link = createMutationGuardLink({
      shouldAllowMutation: () => false,
      getMutationBlockMessage: ({ path }) => `Blocked ${path}`,
    })({});

    const result = observableToPromise(
      link({
        op: {
          id: 1,
          type: "mutation",
          path: "groceries.create",
          input: { name: "Milk" },
          context: {},
          signal: null,
        },
        next,
      }),
    );

    await expect(result).rejects.toMatchObject({
      message: "Blocked groceries.create",
      meta: {
        guard: "mutation-reachability",
        mutationPath: "groceries.create",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes queries through without invoking the guard", async () => {
    const next = vi.fn(() =>
      observable((observer) => {
        observer.next({
          result: {
            type: "data",
            data: { ok: true },
          },
        } as never);
        observer.complete();
      }),
    );
    const shouldAllowMutation = vi.fn(() => false);
    const link = createMutationGuardLink({ shouldAllowMutation })({});

    const result = await observableToPromise(
      link({
        op: {
          id: 1,
          type: "query",
          path: "groceries.list",
          input: undefined,
          context: {},
          signal: null,
        },
        next,
      }),
    );

    expect(result).toMatchObject({
      result: {
        data: { ok: true },
      },
    });
    expect(shouldAllowMutation).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes allowed mutations through to the next link", async () => {
    const next = vi.fn(() =>
      observable((observer) => {
        observer.next({
          result: {
            type: "data",
            data: { ok: true },
          },
        } as never);
        observer.complete();
      }),
    );
    const shouldAllowMutation = vi.fn(() => true);
    const link = createMutationGuardLink({ shouldAllowMutation })({});

    const result = await observableToPromise(
      link({
        op: {
          id: 2,
          type: "mutation",
          path: "groceries.create",
          input: { name: "Milk" },
          context: {},
          signal: null,
        },
        next,
      }),
    );

    expect(result).toMatchObject({
      result: {
        data: { ok: true },
      },
    });
    expect(shouldAllowMutation).toHaveBeenCalledWith({
      path: "groceries.create",
      input: { name: "Milk" },
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
