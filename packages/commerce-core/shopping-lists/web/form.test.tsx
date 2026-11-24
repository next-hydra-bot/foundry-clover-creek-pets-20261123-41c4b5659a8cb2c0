import { Deferred, Effect } from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ShoppingListFailure } from "../../domain/shopping-list";
import { toShoppingListActionError } from "./action-contract";
import type {
  ShoppingListAction,
  ShoppingListActionResult,
} from "./action-contract";
import { ShoppingListForm } from "./form";

const saved = vi.fn<(destination?: string) => void>();
const refreshed = vi.fn<() => void>();
describe("Shopping list form feedback", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  afterAll(() => vi.unstubAllGlobals());

  function mount(action: ShoppingListAction) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <ShoppingListForm
          action={action}
          onSaved={saved}
          onRefresh={refreshed}
          fields={{
            _tag: "Create",
            businessUnitId: "",
            locale: "en-US",
            storeKey: "store",
          }}
          label="Create list"
          pendingLabel="Saving…"
          refreshLabel="Refresh list"
          savedLabel="Saved."
        >
          <input name="name" defaultValue="Weekly" />
        </ShoppingListForm>
      );
    });
    const form = container.querySelector("form");
    if (!form) {
      throw new Error("Expected a list form");
    }
    return { container, form };
  }

  it("keeps failures visible and refreshes without automatically repeating a write", async () => {
    const action = vi.fn<ShoppingListAction>(
      async () =>
        await Promise.resolve({
          _tag: "Failure",
          failure: {
            displayMessage: "This list changed. Refresh before saving.",
            error: toShoppingListActionError(
              new ShoppingListFailure({
                operation: "update",
                reason: "conflict",
                message: "Conflict",
              })
            ),
          },
        })
    );
    const { container, form } = mount(action);
    act(() => {
      form.requestSubmit();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "This list changed"
      );
    });
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[0].get("storeKey")).toBe("store");
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Refresh list"
    );
    if (!refresh) {
      throw new Error("Expected a refresh control");
    }
    act(() => {
      refresh.click();
    });
    expect(refreshed).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it("blocks duplicate submission while pending and opens the created list", async () => {
    const pending = await Effect.runPromise(
      Deferred.make<ShoppingListActionResult>()
    );
    const action = vi.fn<ShoppingListAction>(
      async () => await Effect.runPromise(Deferred.await(pending))
    );
    const { container, form } = mount(action);
    act(() => {
      form.requestSubmit();
    });
    await vi.waitFor(() => {
      expect(container.querySelector("fieldset")?.disabled).toBeTruthy();
    });
    expect(container.textContent).toContain("Saving…");
    await act(async () => {
      await Effect.runPromise(
        Deferred.succeed(pending, {
          _tag: "Success",
          success: {
            locale: "en-US",
            destination: "/en-US/account/shopping-lists/list-1",
          },
        })
      );
    });
    await vi.waitFor(() => {
      expect(saved).toHaveBeenCalledWith(
        "/en-US/account/shopping-lists/list-1"
      );
    });
    expect(refreshed).not.toHaveBeenCalled();
    expect(container.querySelector("fieldset")?.disabled).toBeFalsy();
  });
});
