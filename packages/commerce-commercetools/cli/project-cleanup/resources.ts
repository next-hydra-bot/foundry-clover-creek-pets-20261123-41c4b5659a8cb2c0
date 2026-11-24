import type {
  ByProjectKeyRequestBuilder,
  Category,
  CustomObject,
  Product,
} from "@commercetools/platform-sdk";
import { Effect } from "effect";

import {
  listCleanupEntries,
  ProjectCleanupError,
  requestCleanup,
} from "./cleanup";
import type {
  CleanupCandidate,
  CleanupPageQuery,
  CleanupTarget,
} from "./cleanup";

interface VersionedEntry {
  readonly id: string;
  readonly version: number;
  readonly key?: string;
}

interface Collection<A extends VersionedEntry> {
  readonly get: (input: { queryArgs: CleanupPageQuery }) => {
    readonly execute: () => Promise<{ body: { results: readonly A[] } }>;
  };
}

interface CollectionById extends Collection<VersionedEntry> {
  readonly withId: (input: { ID: string }) => {
    readonly delete: (input: {
      queryArgs: { version: number; dataErasure?: false };
    }) => {
      readonly execute: () => Promise<{ body: unknown }>;
    };
  };
}

const collectionTarget = <A extends VersionedEntry>(
  name: string,
  collection: Collection<A>,
  remove: (item: A) => Effect.Effect<unknown, ProjectCleanupError>,
  options: {
    readonly cursorField?: CleanupTarget["cursorField"];
    readonly sequential?: boolean;
    readonly hierarchy?: (
      item: A
    ) => NonNullable<CleanupCandidate["hierarchy"]>;
  } = {}
): CleanupTarget => ({
  cursorField: options.cursorField,
  list: (queryArgs) =>
    requestCleanup(`List ${name}`, () => collection.get({ queryArgs })).pipe(
      Effect.map(({ results }) =>
        results.map((item) => ({
          id: item.id,
          key: item.key,
          hierarchy: options.hierarchy?.(item),
          remove: Effect.suspend(() => remove(item)),
        }))
      )
    ),
  name,
  sequential: options.sequential,
});

const byId = (name: string, collection: CollectionById, dataErasure?: false) =>
  collectionTarget(name, collection, ({ id, version }) =>
    requestCleanup(`Delete ${name}`, () =>
      collection.withId({ ID: id }).delete({
        queryArgs:
          dataErasure === undefined ? { version } : { dataErasure, version },
      })
    )
  );

const ignoreMissing = <A>(effect: Effect.Effect<A, ProjectCleanupError>) =>
  effect.pipe(
    Effect.catch((error) =>
      error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error)
    )
  );

const requireUnchanged = (
  name: string,
  expected: VersionedEntry,
  current: VersionedEntry
) =>
  expected.id === current.id && expected.version === current.version
    ? Effect.void
    : Effect.fail(
        new ProjectCleanupError({
          message: `${name} changed after listing. Preview again before deleting it.`,
          status: 409,
        })
      );

const removeProduct = (
  api: ByProjectKeyRequestBuilder,
  item: Product,
  batchSize: number
) =>
  Effect.gen(function* () {
    const product = api.products().withId({ ID: item.id });
    const selectionIds = new Set<string>();
    for (let offset = 0; ; offset += batchSize) {
      const { results } = yield* requestCleanup(
        "List Product Selection assignments",
        () =>
          product.productSelections().get({
            queryArgs: { limit: batchSize, offset, withTotal: false },
          })
      );
      for (const assignment of results) {
        selectionIds.add(assignment.productSelection.id);
      }
      if (results.length < batchSize) {
        break;
      }
    }
    const current = yield* requestCleanup("Read product before deletion", () =>
      product.get()
    );
    yield* requireUnchanged("Product", item, current);
    const unpublished = current.masterData.published
      ? yield* requestCleanup("Unpublish product", () =>
          product.post({
            body: {
              actions: [{ action: "unpublish" }],
              version: current.version,
            },
          })
        )
      : current;
    for (const selectionId of selectionIds) {
      const selection = api.productSelections().withId({ ID: selectionId });
      const existing = yield* ignoreMissing(
        requestCleanup("Read Product Selection", () => selection.get())
      );
      if (existing) {
        yield* ignoreMissing(
          requestCleanup(
            `Detach product from Product Selection ${selectionId}`,
            () =>
              selection.post({
                body: {
                  actions: [
                    {
                      action: "removeProduct",
                      product: { id: item.id, typeId: "product" },
                    },
                  ],
                  version: existing.version,
                },
              })
          )
        );
      }
    }
    yield* requestCleanup("Delete product", () =>
      product.delete({ queryArgs: { version: unpublished.version } })
    );
  });

const productSelections = (
  api: ByProjectKeyRequestBuilder,
  batchSize: number
) =>
  collectionTarget(
    "product-selections",
    api.productSelections(),
    (item) =>
      Effect.gen(function* () {
        const selection = api.productSelections().withId({ ID: item.id });
        const current = yield* requestCleanup(
          "Read Product Selection before deletion",
          () => selection.get()
        );
        yield* requireUnchanged("Product Selection", item, current);
        const stores = yield* listCleanupEntries(
          "stores",
          (queryArgs) =>
            requestCleanup("List stores", () =>
              api.stores().get({ queryArgs })
            ).pipe(Effect.map(({ results }) => results)),
          { batchSize, limit: Number.POSITIVE_INFINITY, where: [] }
        );
        for (const store of stores) {
          if (
            store.productSelections.some(
              ({ productSelection }) => productSelection.id === item.id
            )
          ) {
            yield* ignoreMissing(
              requestCleanup(
                `Detach Product Selection from Store ${store.id}`,
                () =>
                  api
                    .stores()
                    .withId({ ID: store.id })
                    .post({
                      body: {
                        actions: [
                          {
                            action: "removeProductSelection",
                            productSelection: {
                              id: item.id,
                              typeId: "product-selection",
                            },
                          },
                        ],
                        version: store.version,
                      },
                    })
              )
            );
          }
        }
        yield* requestCleanup("Delete Product Selection", () =>
          selection.delete({ queryArgs: { version: current.version } })
        );
      }),
    { sequential: true }
  );

const categories = (api: ByProjectKeyRequestBuilder) =>
  collectionTarget(
    "categories",
    api.categories(),
    (item: Category) =>
      Effect.gen(function* () {
        // Deleting a root category can cascade. Require its children to be gone first.
        const children = yield* requestCleanup(
          "Check for child categories",
          () =>
            api.categories().get({
              queryArgs: {
                limit: 1,
                where: `parent(id=${JSON.stringify(item.id)})`,
                withTotal: false,
              },
            })
        );
        if (children.results.length > 0) {
          return yield* new ProjectCleanupError({
            message:
              "Category still has children. Select and delete the children first.",
          });
        }
        yield* requestCleanup("Delete category", () =>
          api
            .categories()
            .withId({ ID: item.id })
            .delete({ queryArgs: { version: item.version } })
        );
      }),
    {
      hierarchy: (item) => ({
        key: item.id,
        parent: item.parent?.id,
      }),
      sequential: true,
    }
  );

const businessUnits = (api: ByProjectKeyRequestBuilder) =>
  collectionTarget(
    "business-units",
    api.businessUnits(),
    (item) =>
      requestCleanup("Delete Business Unit", () =>
        api
          .businessUnits()
          .withId({ ID: item.id })
          .delete({ queryArgs: { version: item.version } })
      ),
    {
      hierarchy: (item) => ({
        key: item.key,
        parent: item.unitType === "Division" ? item.parentUnit.key : undefined,
      }),
      sequential: true,
    }
  );

const customObjects = (api: ByProjectKeyRequestBuilder, container: string) => {
  const collection = api.customObjects();
  return collectionTarget(
    `custom-objects (${JSON.stringify(container)})`,
    collection.withContainer({ container }),
    (item: CustomObject) =>
      Effect.gen(function* () {
        const object = collection.withContainerAndKey({
          container,
          key: item.key,
        });
        // Container/key can be reused with a new ID and the same version.
        const current = yield* requestCleanup(
          "Read Custom Object before deletion",
          () => object.get()
        );
        yield* requireUnchanged("Custom Object", item, current);
        yield* requestCleanup("Delete Custom Object", () =>
          object.delete({
            queryArgs: { dataErasure: false, version: item.version },
          })
        );
      }),
    { cursorField: "key" }
  );
};

// Follow the native cleanup sequence, including Carts before Orders.
// Delete Shipping Methods before their Stores, Zones, and Tax Categories.
export const cleanupResources = [
  "order-edits",
  "carts",
  "orders",
  "shopping-lists",
  "payments",
  "quotes",
  "staged-quotes",
  "quote-requests",
  "business-units",
  "reviews",
  "customers",
  "discount-codes",
  "cart-discounts",
  "standalone-prices",
  "inventory-entries",
  "product-selections",
  "products",
  "categories",
  "product-discounts",
  "product-types",
  "customer-groups",
  "custom-objects",
  "shipping-methods",
  "stores",
  "zones",
  "tax-categories",
  "channels",
  "types",
] as const;

export type CleanupResource = (typeof cleanupResources)[number];

export const cleanupTargets = (
  api: ByProjectKeyRequestBuilder,
  resources: ReadonlySet<CleanupResource>,
  containers: readonly string[],
  batchSize: number
): readonly CleanupTarget[] => {
  const targets = {
    "business-units": businessUnits(api),
    "cart-discounts": byId("cart-discounts", api.cartDiscounts()),
    carts: byId("carts", api.carts(), false),
    categories: categories(api),
    channels: byId("channels", api.channels()),
    "customer-groups": byId("customer-groups", api.customerGroups()),
    customers: byId("customers", api.customers(), false),
    "discount-codes": byId("discount-codes", api.discountCodes()),
    "inventory-entries": byId("inventory-entries", api.inventory()),
    "order-edits": byId("order-edits", api.orders().edits()),
    orders: byId("orders", api.orders(), false),
    payments: byId("payments", api.payments(), false),
    "product-discounts": byId("product-discounts", api.productDiscounts()),
    "product-selections": productSelections(api, batchSize),
    "product-types": byId("product-types", api.productTypes()),
    products: collectionTarget(
      "products",
      api.products(),
      (item) => removeProduct(api, item, batchSize),
      { sequential: true }
    ),
    "quote-requests": byId("quote-requests", api.quoteRequests()),
    quotes: byId("quotes", api.quotes()),
    reviews: byId("reviews", api.reviews()),
    "shipping-methods": byId("shipping-methods", api.shippingMethods()),
    "shopping-lists": byId("shopping-lists", api.shoppingLists()),
    "standalone-prices": byId("standalone-prices", api.standalonePrices()),
    "staged-quotes": byId("staged-quotes", api.stagedQuotes()),
    stores: byId("stores", api.stores()),
    "tax-categories": byId("tax-categories", api.taxCategories()),
    types: byId("types", api.types()),
    zones: byId("zones", api.zones()),
  } satisfies Record<Exclude<CleanupResource, "custom-objects">, CleanupTarget>;
  return cleanupResources.flatMap((resource) => {
    if (resource === "custom-objects") {
      return containers.map((container) => customObjects(api, container));
    }
    return resources.has(resource) ? [targets[resource]] : [];
  });
};
