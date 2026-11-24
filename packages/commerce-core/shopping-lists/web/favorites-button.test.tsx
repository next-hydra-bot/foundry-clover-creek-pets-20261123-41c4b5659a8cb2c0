import { Schema } from "effect";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
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
import { VariantId } from "../../product/identity";
import { CommerceProductSelection } from "../../product/product-detail-client";
import { toShoppingListActionError } from "./action-contract";
import type { ShoppingListAction } from "./action-contract";
import { FavoritesControl, ProductListPicker } from "./favorites-button";
import type { ListChoice } from "./favorites-button";

const labels = {
  add: "Add to Wish List",
  chooseVariant: "Choose a variant",
  create: "Create list and add item",
  favorites: "Wish List",
  name: "List name",
  otherList: "Add to another list",
  refresh: "Refresh",
  remove: "Remove from Wish List",
  save: "Add item",
  saved: "Saved.",
  saving: "Saving…",
};
const roots: ReturnType<typeof createRoot>[] = [];
describe("PDP Favorites selection", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    document.body.replaceChildren();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });
  function mount(action: ShoppingListAction) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (variantId: string) => {
      act(() => {
        root.render(
          <FavoritesControl
            fields={{ businessUnitId: "", locale: "en-US", storeKey: "store" }}
            labels={labels}
            initialVariantIds={["blue-medium"]}
            variantId={variantId}
            action={action}
          />
        );
      });
    };
    const button = () => {
      const element = container.querySelector("button");
      if (!element) {
        throw new Error("Expected a Favorites control");
      }
      return element;
    };
    return { button, container, render };
  }

  it("reflects saved membership when the selected variant changes", () => {
    const action = vi.fn<ShoppingListAction>(
      async () =>
        await Promise.resolve({ _tag: "Success", success: { locale: "en-US" } })
    );
    const ui = mount(action);
    ui.render("blue-medium");
    expect(ui.button().getAttribute("aria-pressed")).toBe("true");
    ui.render("green-large");
    expect(ui.button().getAttribute("aria-pressed")).toBe("false");
    ui.render("blue-medium");
    expect(ui.button().getAttribute("aria-pressed")).toBe("true");
  });

  it("updates the indicator as variants change and saves/removes the exact selected variant", async () => {
    const action = vi.fn<ShoppingListAction>(
      async (form) =>
        await Promise.resolve({
          _tag: "Success",
          success: {
            favorite: {
              saved: form.get("saved") === "true",
              variantId: Schema.decodeUnknownSync(VariantId)(
                form.get("variantId")
              ),
            },
            locale: "en-US",
          },
        })
    );
    const ui = mount(action);
    ui.render("green-large");
    act(() => {
      ui.button().click();
    });
    await vi.waitFor(() => {
      expect(ui.button().getAttribute("aria-pressed")).toBe("true");
    });
    expect(action.mock.calls[0]?.[0].get("variantId")).toBe("green-large");
    ui.render("blue-medium");
    act(() => {
      ui.button().click();
    });
    await vi.waitFor(() => {
      expect(ui.button().getAttribute("aria-pressed")).toBe("false");
    });
    expect(action.mock.calls[1]?.[0].get("saved")).toBe("false");
    ui.render("green-large");
    expect(ui.button().getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the last confirmed indicator and shows a failed write", async () => {
    const action = vi.fn<ShoppingListAction>(
      async () =>
        await Promise.resolve({
          _tag: "Failure",
          failure: {
            displayMessage: "Could not confirm the change.",
            error: toShoppingListActionError(
              new ShoppingListFailure({
                message: "Unconfirmed",
                operation: "update",
                reason: "outcomeUnknown",
              })
            ),
          },
        })
    );
    const ui = mount(action);
    ui.render("green-large");
    act(() => {
      ui.button().click();
    });
    await vi.waitFor(() => {
      expect(
        ui.container.querySelector('[role="alert"]')?.textContent
      ).toContain("Could not confirm");
    });
    expect(ui.button().getAttribute("aria-pressed")).toBe("false");
    expect(action).toHaveBeenCalledOnce();
  });
});

const pickerRouter = {
  back: vi.fn<() => void>(),
  bfcacheId: "test-page",
  forward: vi.fn<() => void>(),
  hmrRefresh: vi.fn<() => void>(),
  prefetch: vi.fn<() => void>(),
  push: vi.fn<() => void>(),
  refresh: vi.fn<() => void>(),
  replace: vi.fn<() => void>(),
};

describe("PDP list picker", () => {
  const first = { id: "first-list", name: "Weekly", revision: "1" };
  const remaining = { id: "remaining-list", name: "Monthly", revision: "3" };
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    document.body.replaceChildren();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { initial: [first, remaining], name: "selected list is removed" },
    { initial: [], name: "choices become available" },
  ])("uses an available list when $name", ({ initial }) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (choices: readonly ListChoice[]) => {
      act(() => {
        root.render(
          <AppRouterContext.Provider value={pickerRouter}>
            <CommerceProductSelection
              product={{
                availableForSale: true,
                defaultVariantId: "variant",
                productId: "product",
                title: "Product",
                variantLabel: "Variant",
                variants: [
                  {
                    id: "variant",
                    value: "variant",
                    label: "Variant",
                    options: [],
                    isInStock: true,
                  },
                ],
              }}
            >
              <ProductListPicker
                fields={{
                  businessUnitId: "",
                  authUserId: "customer",
                  locale: "en-US",
                  storeKey: "store",
                }}
                labels={labels}
                choices={choices}
              />
            </CommerceProductSelection>
          </AppRouterContext.Provider>
        );
      });
    };
    render(initial);
    render([remaining]);
    expect(container.querySelector("select")?.value).toBe(remaining.id);
    expect(
      container.querySelector<HTMLInputElement>('input[name="id"]')?.value
    ).toBe(remaining.id);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="expectedRevision"]'
      )?.value
    ).toBe(remaining.revision);
  });
});
