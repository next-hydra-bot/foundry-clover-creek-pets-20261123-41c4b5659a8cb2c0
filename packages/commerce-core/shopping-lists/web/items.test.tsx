import { Effect, Schema } from "effect";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShoppingList } from "../../domain/shopping-list";
import { ProductVariantCard } from "../../product/model";
import { ProductDiscovery } from "../../product/product-discovery";
import { ShoppingListItems } from "./items";

const catalog = vi.hoisted(
  (): { unavailable: boolean; products: unknown[] } => ({
    unavailable: false,
    products: [],
  })
);
vi.mock("@repo/i18n", () => ({ getTranslations: () => (key: string) => key }));
vi.mock("./actions", () => ({ saveShoppingList: vi.fn() }));
vi.mock("./form", () => ({
  ConnectedShoppingListForm: ({
    label,
    children,
  }: {
    label: string;
    children?: ReactNode;
  }) => (
    <form>
      {children}
      <button>{label}</button>
    </form>
  ),
}));
vi.mock("../../product/catalog-runtime", () => ({
  CatalogRuntime: {
    run: async (
      _locale: string,
      effect: Effect.Effect<unknown, unknown, ProductDiscovery>
    ) => {
      if (catalog.unavailable) throw new Error("Catalog context unavailable");
      return await Effect.runPromise(
        effect.pipe(
          Effect.provide(
            ProductDiscovery.testLayer({
              findVariantCards: () =>
                Effect.succeed(
                  Schema.decodeUnknownSync(Schema.Array(ProductVariantCard))(
                    catalog.products
                  )
                ),
            })
          )
        )
      );
    },
  },
}));

const list = Schema.decodeUnknownSync(ShoppingList)({
  id: "list",
  revision: "r1",
  storeKey: "store",
  purpose: "shopping",
  name: { en: "Weekly" },
  ownership: { _tag: "Customer", authUserId: "site-user" },
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [
    {
      id: "line",
      variantId: "opaque-variant",
      quantity: 2,
      addedAt: new Date(),
    },
  ],
});
const render = async () => {
  const element = await ShoppingListItems({
    locale: "en-US",
    list,
    fields: {},
  });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  return container;
};

describe("Saved product rows", () => {
  afterEach(() => {
    catalog.unavailable = false;
    catalog.products = [];
  });

  it("shows product identity, selected options and the saved quantity", async () => {
    catalog.products = [
      {
        id: "opaque-variant",
        productId: "product",
        slug: "trail-jacket",
        title: "Trail jacket",
        featuredImage: {
          url: "https://images.example.com/jacket.png",
          altText: "Blue trail jacket",
        },
        options: [
          { name: "Color", value: "Blue" },
          { name: "Size", value: "Large" },
        ],
        availability: { availableForSale: true },
      },
    ];
    const view = await render();
    expect(view.querySelector("a")?.textContent).toBe("Trail jacket");
    expect(view.querySelector("a")?.getAttribute("href")).toBe(
      "/en-US/products/trail-jacket?variant=opaque-variant"
    );
    expect(view.querySelector("img")?.alt).toBe("Blue trail jacket");
    expect(view.querySelector("dl")?.textContent).toContain("Color:Blue");
    expect(view.querySelector("dl")?.textContent).toContain("Size:Large");
    expect(
      view.querySelector<HTMLInputElement>('input[name="quantity"]')?.value
    ).toBe("2");
  });

  it("keeps unavailable product lines removable", async () => {
    const view = await render();
    expect(view.textContent).toContain("removedProduct");
    expect(
      [...view.querySelectorAll("button")].map((button) => button.textContent)
    ).toContain("remove");
  });

  it("keeps rows editable when catalog context fails", async () => {
    catalog.unavailable = true;
    const view = await render();
    expect(view.querySelector('[role="status"]')?.textContent).toBe(
      "catalogUnavailable"
    );
    expect(view.textContent).toContain("productDetailsUnavailable");
    expect(
      view.querySelector<HTMLInputElement>('input[name="quantity"]')?.value
    ).toBe("2");
  });
});
