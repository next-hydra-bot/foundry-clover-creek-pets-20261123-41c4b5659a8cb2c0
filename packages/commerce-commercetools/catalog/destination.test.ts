import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import { expect, layer } from "@effect/vitest";
import { provisionMigrationGroup } from "@repo/cli-core/provision-migrations";
import { loadCatalog } from "@repo/commerce-core/catalog/files";
import { Effect, Schema } from "effect";
import { MigrationStore } from "migrate-sdk";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";

import { makeCatalogDestination, makeCatalogSdk } from "./destination";
import { discountKey, productDraft } from "./mapping";
import { makeCatalogRegistry } from "./migrations";
import { productTypes } from "./schema";
import { testTracking } from "./tracking.test-fixture";

const source = loadCatalog("b2c").products.find(
  ({ key }) => key === "outdoor-insulated-bottle"
);
if (source === undefined) {
  throw new Error("Missing catalog bottle");
}
const bottle = source;
const target = {
  discountId: "discount-1",
  distributionChannelId: "distribution-1",
};

const selection = () => ({
  id: "selection-1",
  mode: "Individual",
  productCount: 0,
  version: 1,
});
const list = (results: readonly Schema.Json[]) => ({ results });
const respond = (body: Schema.Json) => Response.json(body);

const fixture = (
  options: {
    readonly channels?: boolean;
    readonly foreign?: boolean;
    readonly extraPrice?: boolean;
    readonly failInventoryWrite?: boolean;
    readonly loseCreateResponse?: boolean;
  } = {}
) => {
  const writes: { path: string; body: Schema.Json }[] = [];
  const categories = new Map<
    string,
    { id: string; key: string; externalId: string; version: number }
  >();
  let productExists = options.foreign ?? false;
  let ambiguous = options.loseCreateResponse ?? false;
  let selectionExists = false;
  let discountExists = false;
  let assigned = false;
  let inventoryExists = false;
  let quantity = 0;
  let productVersion = 1;
  let published = options.foreign ?? false;
  const draft = productDraft("b2c", bottle, target);
  const currentCategories = new Map<string, string | undefined>();
  const stagedCategories = new Map<string, string | undefined>();
  const productData = (categories: typeof currentCategories) => ({
    categories: Array.from(categories.keys(), (id) => ({
      id,
      typeId: "category",
    })),
    categoryOrderHints: Object.fromEntries(
      [...categories].filter(([, hint]) => hint !== undefined)
    ),
    masterVariant: {
      ...draft.masterVariant,
      id: 1,
      key: options.foreign ? "someone-else" : draft.masterVariant?.key,
      prices: [
        ...(draft.masterVariant?.prices ?? []),
        ...(options.extraPrice
          ? [
              {
                key: "company-price",
                channel: { id: "company-channel", typeId: "channel" },
                value: { centAmount: 999, currencyCode: "USD" },
              },
            ]
          : []),
      ],
    },
    variants: [],
  });
  const nativeProduct = () => ({
    id: "product-1",
    masterData: {
      published,
      current: productData(currentCategories),
      staged: productData(stagedCategories),
    },
    productType: { id: "type-outdoor-product", typeId: "product-type" },
    version: productVersion,
  });
  const inventory = () => ({
    id: "inventory-1",
    quantityOnStock: quantity,
    sku: bottle.variants[0].sku,
    version: 1,
  });
  // oxlint-disable-next-line complexity -- The native SDK fixture keeps its HTTP resource routes together.
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(new Request(input).url);
    const path = url.pathname.replace("/test", "");
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const body = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
        await new Response(init?.body).text()
      );
      writes.push({ body, path });
      if (path === "/categories") {
        const input = Schema.decodeUnknownSync(
          Schema.Struct({ externalId: Schema.String, key: Schema.String })
        )(body);
        const category = {
          ...input,
          id: `category-${categories.size + 1}`,
          version: 1,
        };
        categories.set(input.key, category);
        return respond(category);
      }
      if (path.startsWith("/categories/")) {
        const category = [...categories.values()].find(
          ({ id }) => path === `/categories/${id}`
        );
        if (category === undefined) {
          throw new Error("Missing category");
        }
        return respond({ ...category, version: category.version + 1 });
      }
      if (path === "/products") {
        productExists = true;
        if (ambiguous) {
          ambiguous = false;
          return new Response("response lost", { status: 503 });
        }
        return respond(Schema.decodeUnknownSync(Schema.Json)(nativeProduct()));
      }
      if (path === "/products/product-1") {
        const { actions } = Schema.decodeUnknownSync(
          Schema.Struct({
            actions: Schema.Array(
              Schema.Struct({
                action: Schema.String,
                category: Schema.optionalKey(
                  Schema.Struct({ id: Schema.String })
                ),
                orderHint: Schema.optionalKey(Schema.String),
                staged: Schema.optionalKey(Schema.Boolean),
              })
            ),
          })
        )(body);
        for (const { action, category, orderHint, staged } of actions) {
          if (action === "addToCategory" && category) {
            stagedCategories.set(category.id, orderHint);
            if (staged === false) {
              currentCategories.set(category.id, orderHint);
            }
          }
          if (action === "publish") {
            published = true;
            currentCategories.clear();
            for (const [categoryId, hint] of stagedCategories) {
              currentCategories.set(categoryId, hint);
            }
          }
        }
        productVersion += 1;
        return respond(Schema.decodeUnknownSync(Schema.Json)(nativeProduct()));
      }
      if (path === "/product-selections") {
        selectionExists = true;
        return respond(selection());
      }
      if (path === "/product-selections/selection-1") {
        assigned = true;
        return respond(selection());
      }
      if (path === "/product-discounts") {
        discountExists = true;
        return respond({ id: "discount-1", version: 1 });
      }
      if (path.startsWith("/inventory")) {
        if (options.failInventoryWrite) {
          return Response.json(
            { message: "Inventory unavailable" },
            { status: 503 }
          );
        }
        inventoryExists = true;
        const parsed = Schema.decodeUnknownSync(
          Schema.Struct({
            actions: Schema.optional(
              Schema.Array(Schema.Struct({ quantity: Schema.Number }))
            ),
            quantityOnStock: Schema.optional(Schema.Number),
          })
        )(body);
        quantity =
          parsed.quantityOnStock ?? parsed.actions?.[0]?.quantity ?? quantity;
        return respond(inventory());
      }
      if (path === "/stores/key=default-store") {
        return respond({
          id: "store-1",
          key: "default-store",
          productSelections: [{ active: true }],
          version: 2,
        });
      }
      throw new Error(`Unexpected native write ${path}`);
    }
    if (path === "/stores/key=default-store") {
      return respond({
        distributionChannels: [{ id: "distribution-1" }],
        id: "store-1",
        productSelections: [],
        supplyChannels: options.channels === false ? [] : [{ id: "supply-1" }],
        version: 1,
      });
    }
    if (path === "/categories") {
      const key = url.searchParams.get("where")?.match(/^key="(?<key>.*)"$/u)
        ?.groups?.key;
      return respond(
        list(
          [...categories.values()].filter((category) => category.key === key)
        )
      );
    }
    if (path === "/product-types") {
      const key = url.searchParams.get("where")?.match(/^key="(?<key>.*)"$/u)
        ?.groups?.key;
      return respond(
        list(
          Schema.decodeUnknownSync(Schema.Array(Schema.Json))(
            productTypes
              .filter((type) => type.key === key)
              .map((type) => ({ ...type, id: `type-${type.key}` }))
          )
        )
      );
    }
    if (path === "/product-types/key=outdoor-product") {
      return respond({ id: "type-outdoor-product" });
    }
    if (path === "/product-selections") {
      return respond(list(selectionExists ? [selection()] : []));
    }
    if (path === "/product-selections/selection-1") {
      return respond(selection());
    }
    if (path === "/product-selections/selection-1/products") {
      return respond(list(assigned ? [{ product: { id: "product-1" } }] : []));
    }
    if (path === "/product-discounts") {
      return respond(
        list(
          discountExists
            ? [
                {
                  id: "discount-1",
                  isActive: true,
                  key: discountKey("b2c"),
                  predicate: loadCatalog("b2c")
                    .products.flatMap(({ variants }) =>
                      variants.map(({ sku }) => `sku = ${JSON.stringify(sku)}`)
                    )
                    .join(" or "),
                  value: { type: "external" },
                },
              ]
            : []
        )
      );
    }
    if (path === "/products") {
      return respond(
        list(
          productExists
            ? [Schema.decodeUnknownSync(Schema.Json)(nativeProduct())]
            : []
        )
      );
    }
    if (path === "/products/product-1") {
      return respond(Schema.decodeUnknownSync(Schema.Json)(nativeProduct()));
    }
    if (path === "/inventory") {
      return respond(list(inventoryExists ? [inventory()] : []));
    }
    throw new Error(`Unexpected native read ${path}`);
  };
  const sdk = new ClientBuilder()
    .withHttpMiddleware({
      enableRetry: false,
      host: "https://api.example.test",
      httpClient: fetcher,
    })
    .build();
  const destination = makeCatalogDestination(
    Effect.succeed({
      ...makeCatalogSdk(createApiBuilderFromCtpClient(sdk), "test"),
      storeKey: "default-store",
      distributionChannelId: "distribution-1",
      supplyChannelId: "supply-1",
    })
  );
  return { currentCategories, destination, stagedCategories, writes };
};

layer(testTracking)("Commercetools catalog destination", (it) => {
  it.effect(
    "journals the relationships and assigns Store selection membership when inventory fails",
    () =>
      Effect.gen(function* () {
        const { destination, writes } = fixture({ failInventoryWrite: true });
        const store = InMemoryMigrationStore.layer();
        const registry = makeCatalogRegistry({
          catalogs: {
            b2c: {
              ...loadCatalog("b2c"),
              products: [{ ...bottle, relatedProductKeys: [] }],
            },
          },
          destination,
          store,
        });
        yield* provisionMigrationGroup(registry, "b2c").pipe(Effect.flip);
        const readState = (id: string) =>
          MigrationStore.pipe(
            Effect.flatMap((state) => {
              const definition = registry
                .definitions()
                .find((definition) => definition.id === id);
              return definition
                ? state.listItemStates(definition.id)
                : Effect.die(`Missing migration ${id}`);
            }),
            Effect.provide(store)
          );
        const [categories] = yield* readState("b2c-category-products");
        const [references] = yield* readState("b2c-product-references");
        const [inventory] = yield* readState("b2c-inventory");
        const [selection] = yield* readState("b2c-selection-products");
        expect(categories).toMatchObject({
          status: "migrated",
          journal: {
            process: {
              entries: [
                {
                  descriptorId: "commercetools.product.updated",
                  value: { resourceId: "product-1", resourceVersion: 3 },
                },
              ],
            },
          },
        });
        expect(references).toMatchObject({
          status: "migrated",
          journal: {
            process: {
              entries: [
                {
                  descriptorId: "commercetools.product.updated",
                  value: { resourceId: "product-1", resourceVersion: 4 },
                },
              ],
            },
          },
        });
        expect(inventory?.status).toBe("failed");
        expect(selection).toMatchObject({
          status: "migrated",
          trackingRecord: { id: "product-1" },
        });
        expect(
          writes.some(({ path }) => path === "/product-selections/selection-1")
        ).toBeTruthy();
      })
  );

  it.effect(
    "publishes with the Product write and applies relationships through their own destinations",
    () =>
      Effect.gen(function* () {
        const { destination, writes } = fixture();
        yield* destination.ensureProductType(bottle.productType);
        const selection = yield* destination.ensureSelection("b2c");
        const id = yield* destination.upsertProduct("b2c", bottle);
        expect(
          writes.find(({ path }) => path === "/products")?.body
        ).toMatchObject({
          publish: false,
        });
        yield* destination.addProductCategories(id, ["category-1"]);
        yield* destination.addProductCategories(id, ["category-2"]);
        yield* destination.addProductCategories(id, ["category-2"]);
        yield* destination.assignProductReferences(
          bottle,
          id,
          ["related-1"],
          {}
        );
        for (const variant of bottle.variants) {
          yield* destination.upsertInventory(variant.sku, variant.quantity);
          yield* destination.upsertInventory(variant.sku, variant.quantity);
        }
        yield* destination.assignSelectionProduct(id, selection);
        yield* destination.assignSelectionProduct(id, selection);
        expect(writes.filter(({ path }) => path === "/inventory")).toHaveLength(
          bottle.variants.length
        );
        expect(
          writes.filter(
            ({ path }) => path === "/product-selections/selection-1"
          )
        ).toHaveLength(1);
        expect(
          writes
            .filter(({ path }) => path === "/products/product-1")
            .map(({ body }) => body)
        ).toMatchObject([
          { actions: [{ action: "publish" }], version: 1 },
          {
            actions: [
              {
                action: "addToCategory",
                category: { id: "category-1" },
                staged: false,
              },
            ],
          },
          {
            actions: [
              {
                action: "addToCategory",
                category: { id: "category-2" },
                staged: false,
              },
            ],
          },
          {
            actions: [
              {
                action: "setAttributeInAllVariants",
                staged: false,
                value: [{ id: "related-1" }],
              },
            ],
          },
        ]);
      })
  );
  it.effect(
    "adds missing category memberships in each projection and keeps order hints",
    () =>
      Effect.gen(function* () {
        const { currentCategories, destination, stagedCategories } = fixture();
        yield* destination.ensureSelection("b2c");
        const id = yield* destination.upsertProduct("b2c", bottle);
        currentCategories.set("current-only", "0.1");
        stagedCategories.set("staged-only", "0.2");
        currentCategories.set("merchant-category", "0.3");
        yield* destination.addProductCategories(id, [
          "current-only",
          "staged-only",
        ]);
        expect(Object.fromEntries(currentCategories)).toEqual({
          "current-only": "0.1",
          "merchant-category": "0.3",
          "staged-only": "0.2",
        });
        expect(Object.fromEntries(stagedCategories)).toEqual({
          "current-only": "0.1",
          "staged-only": "0.2",
        });
        yield* destination.upsertProduct("b2c", {
          ...bottle,
          title: "New title",
        });
        expect(currentCategories.get("merchant-category")).toBe("0.3");
        expect(stagedCategories.has("merchant-category")).toBeFalsy();
      })
  );
  it.effect(
    "upserts category translations and maps product category keys to native references",
    () =>
      Effect.gen(function* () {
        const { destination, writes } = fixture();
        const [category] = loadCatalog("b2c").categories;
        if (category === undefined) {
          return yield* Effect.die("Missing category");
        }
        const first = yield* destination.upsertCategory("b2c", category);
        expect(yield* destination.upsertCategory("b2c", category)).toBe(first);
        expect(
          writes.filter(({ path }) => path === "/categories")
        ).toHaveLength(1);
        expect(
          writes.find(({ path }) => path === "/categories")?.body
        ).toMatchObject({
          key: category.key,
          name: { "fr-FR": category.translations["fr-FR"]?.title },
        });
      })
  );
  it.effect(
    "recovers an ambiguous creation by key and reuses the existing product",
    () =>
      Effect.gen(function* () {
        const { destination, writes } = fixture({ loseCreateResponse: true });
        yield* destination.ensureSelection("b2c");
        const first = yield* Effect.result(
          destination.upsertProduct("b2c", bottle)
        );
        expect(first._tag).toBe("Failure");
        expect(yield* destination.upsertProduct("b2c", bottle)).toBe(
          "product-1"
        );
        expect(writes.filter(({ path }) => path === "/products")).toHaveLength(
          1
        );
      })
  );
  it.effect(
    "refuses unrelated products and stores without stock channels",
    () =>
      Effect.gen(function* () {
        const foreign = fixture({ foreign: true });
        yield* foreign.destination.ensureSelection("b2c");
        expect(
          (yield* Effect.result(
            foreign.destination.upsertProduct("b2c", bottle)
          ))._tag
        ).toBe("Failure");
        expect(
          foreign.writes.some(({ path }) => path.startsWith("/products"))
        ).toBeFalsy();
        const unconfigured = fixture({ channels: false });
        expect(
          (yield* Effect.result(
            unconfigured.destination.upsertInventory(bottle.variants[0].sku, 1)
          ))._tag
        ).toBe("Failure");
        expect(unconfigured.writes).toHaveLength(0);
      })
  );
  it.effect(
    "preserves separately managed company prices when product content is reimported",
    () =>
      Effect.gen(function* () {
        const target = fixture({ extraPrice: true });
        yield* target.destination.ensureSelection("b2c");
        yield* target.destination.upsertProduct("b2c", bottle);
        yield* target.destination.upsertProduct("b2c", bottle);
        const updates = target.writes.filter(
          ({ path }) => path === "/products/product-1"
        );
        expect(JSON.stringify(updates)).toContain("company-price");
        expect(JSON.stringify(updates)).toContain("company-channel");
      })
  );
});
