import type {
  ProductExpectation,
  StoreExpectation,
} from "@repo/commerce-checkout/e2e/checkout-scenario";
import { expectMoney } from "@repo/commerce-core/e2e/drivers/money.driver";
import { ProductDriver } from "@repo/commerce-core/e2e/drivers/product.driver";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
} from "@repo/commerce-core/store";
import { expect } from "@repo/e2e-testing";
import type { Locator, Page } from "@repo/e2e-testing";

export class CatalogDriver {
  readonly #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }

  async switchStore(store: StoreExpectation): Promise<void> {
    const region = storeConfiguration.find(
      ({ currency, locale, storeKey, isDefault }) =>
        currency === store.currency &&
        locale === store.locale &&
        storeKey === store.key &&
        isDefault
    );
    if (region === undefined) {
      throw new Error(
        `No customer region selects locale ${store.locale} in currency ${store.currency}`
      );
    }

    const resolvedStore = resolveStore({
      locale: CommerceLocale.make(region.locale),
    });
    if (
      resolvedStore.storeKey !== store.key ||
      resolvedStore.currency !== store.currency
    ) {
      throw new Error(
        `Locale ${store.locale} resolves Store ${resolvedStore.storeKey}/${resolvedStore.currency}, not ${store.key}/${store.currency}`
      );
    }

    await this.#page.goto("/");
    const regionSelector = this.#page.getByRole("button", {
      name: /^Current region /u,
    });
    await regionSelector.click();
    await this.#page
      .getByRole("menuitem")
      .filter({ hasText: region.displayName ?? region.storeKey })
      .click();

    await expect(this.#page.locator("html")).toHaveAttribute(
      "lang",
      store.locale
    );
    await expect(
      this.#page.getByRole("button", {
        name: `Current region ${region.displayName ?? region.storeKey}`,
      })
    ).toBeVisible();
    await this.#expectCommerceContext(store);
  }

  async expectLiveProduct(
    product: ProductExpectation,
    store: StoreExpectation
  ): Promise<void> {
    await expect(this.#productCard(product.name)).toBeVisible();
    await this.openProduct(product.name);
    await this.#expectCommerceContext(store);
    await new ProductDriver(this.#page).selectVariant(product.attributes);
    await expect(
      this.#page.getByText("In Stock", { exact: true }).first()
    ).toBeVisible();
    await expectMoney(
      this.#page.locator('[data-commerce-money="product-price"]'),
      product.price,
      product.currency
    );

    await this.#page.goto(`/${store.locale}`);
    await expect(this.#productCard(product.name)).toBeVisible();
  }

  async openProduct(productName: string): Promise<void> {
    await this.#productCard(productName)
      .getByRole("link", { name: "View Details" })
      .click();
    await expect(
      this.#page.getByRole("heading", { level: 2, name: productName })
    ).toBeVisible({ timeout: 30_000 });
  }

  async #expectCommerceContext(store: StoreExpectation): Promise<void> {
    const context = this.#page.locator("[data-commerce-context]").first();
    await expect(context).toHaveAttribute("data-store-key", store.key);
    await expect(context).toHaveAttribute("data-locale", store.locale);
    await expect(context).toHaveAttribute("data-currency", store.currency);
  }

  #productCard(productName: string): Locator {
    return this.#page
      .locator('[data-slot="card"]')
      .filter({ hasText: productName })
      .first();
  }
}
