import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { describe, expect, it } from "@effect/vitest";
import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
} from "@repo/commerce-core/domain/commerce-account";
import {
  ShoppingListId,
  ShoppingListLineItemId,
  ShoppingListRevision,
} from "@repo/commerce-core/domain/shopping-list";
import { ShoppingLists } from "@repo/commerce-core/services/shopping-lists";
import { StoreKey } from "@repo/commerce-core/store";
import { Effect, Layer, Option } from "effect";

import { CommercetoolsRestClient } from "../client/rest-client";
import { variantReference } from "../product/variant-reference";
import { shoppingListsLayerWithClient } from "./index";

const buyer = {
  authUserId: AuthUserId.make("actor"),
};
const company = {
  authUserId: buyer.authUserId,

  businessUnit: {
    id: CommerceBusinessUnitId.make("company-id"),
    key: CommerceBusinessUnitKey.make("company-key"),
  },
};
const target = {
  id: ShoppingListId.make("list"),
  storeKey: StoreKey.make("store"),
};
const row = (overrides = {}) => ({
  id: "list",
  version: 1,
  name: { en: "Weekly", fr: "Hebdomadaire" },
  customer: { typeId: "customer", id: "buyer" },
  store: { typeId: "store", key: "store" },
  textLineItems: [],
  lineItems: [
    {
      id: "line",
      productId: "product",
      variantId: 2,
      quantity: 2,
      addedAt: "2026-11-03T00:00:00.000Z",
    },
  ],
  createdAt: "2026-11-03T00:00:00.000Z",
  lastModifiedAt: "2026-11-03T00:00:00.000Z",
  ...overrides,
});
type Request = {
  readonly uri: string;
  readonly body?: unknown;
  readonly method?: string;
};
const fixture = (read: (request: Request) => object) =>
  shoppingListsLayerWithClient.pipe(
    Layer.provide(
      CommercetoolsRestClient.testLayer(
        createApiBuilderFromCtpClient({
          execute: async (request: Request) => ({
            body: request.uri.includes("/customers?")
              ? { results: [{ id: "buyer", externalId: buyer.authUserId }] }
              : read(request),
            statusCode: 200,
          }),
        }).withProjectKey({ projectKey: "project" })
      )
    )
  );

describe("native commercetools ShoppingLists", () => {
  it.effect(
    "finds Favorites by native key within the acting customer's company and Store",
    () =>
      Effect.gen(function* () {
        const list = yield* (yield* ShoppingLists).get(company, {
          storeKey: target.storeKey,
          purpose: "favorites",
        });
        expect(Option.getOrThrow(list).purpose).toBe("favorites");
      }).pipe(
        Effect.provide(
          fixture(({ uri }) => {
            const decoded = decodeURIComponent(uri);
            expect(decoded).toContain(
              'key="favorites_company_store_company-id_buyer"'
            );
            expect(decoded).toContain('customer(id="buyer")');
            expect(decoded).toContain('businessUnit(key="company-key")');
            return {
              results: [
                row({
                  key: "favorites_company_store_company-id_buyer",
                  businessUnit: { key: "company-key", typeId: "business-unit" },
                }),
              ],
            };
          })
        )
      )
  );
  it.effect(
    "creates Favorites with a stable native key rather than identifying a translated name",
    () =>
      Effect.gen(function* () {
        const list = yield* (yield* ShoppingLists).create(buyer, {
          storeKey: target.storeKey,
          purpose: "favorites",
          name: { fr: "Favoris" },
          items: [],
        });
        expect(list.purpose).toBe("favorites");
      }).pipe(
        Effect.provide(
          fixture(({ body }) => {
            expect(body).toMatchObject({
              key: "favorites_customer_store_buyer",
              name: { fr: "Favoris" },
            });
            return row({
              key: "favorites_customer_store_buyer",
              lineItems: [],
              name: { fr: "Favoris" },
            });
          })
        )
      )
  );
  it.effect(
    "returns absence when no company list matches the selected scope",
    () =>
      Effect.gen(function* () {
        expect(yield* (yield* ShoppingLists).get(company, target)).toEqual(
          Option.none()
        );
      }).pipe(Effect.provide(fixture(() => ({ results: [] }))))
  );
  it.effect(
    "reports a native Associate permission refusal as access denied",
    () =>
      Effect.gen(function* () {
        const error = yield* (yield* ShoppingLists)
          .get(company, target)
          .pipe(Effect.flip);
        expect(error.reason).toBe("accessDenied");
      }).pipe(
        Effect.provide(
          fixture(() => {
            throw {
              statusCode: 400,
              body: { errors: [{ code: "AssociateMissingPermission" }] },
            };
          })
        )
      )
  );
  it.effect(
    "reports an unreadable successful create response without claiming the write failed",
    () =>
      Effect.gen(function* () {
        const error = yield* (yield* ShoppingLists)
          .create(buyer, {
            storeKey: target.storeKey,
            name: { en: "Weekly" },
            items: [],
          })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          operation: "create",
          reason: "outcomeUnknown",
        });
      }).pipe(Effect.provide(fixture(() => row({ name: {} }))))
  );
  it.effect(
    "reports an unreadable successful update response as outcome unknown",
    () =>
      Effect.gen(function* () {
        const error = yield* (yield* ShoppingLists)
          .update(buyer, {
            ...target,
            expectedRevision: ShoppingListRevision.make("1"),
            actions: [{ _tag: "SetName", locale: "en", value: "Changed" }],
          })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          operation: "update",
          reason: "outcomeUnknown",
        });
      }).pipe(
        Effect.provide(
          fixture(({ method }) =>
            method === "GET" ? row() : row({ name: {} })
          )
        )
      )
  );
  it.effect(
    "maps native line and revision identities without interpreting SKU",
    () =>
      Effect.gen(function* () {
        const list = Option.getOrThrow(
          yield* (yield* ShoppingLists).get(buyer, target)
        );
        expect(list.revision).toBe("1");
        expect(list.items[0]).toMatchObject({
          id: "line",
          variantId: variantReference("product", 2),
          quantity: 2,
        });
      }).pipe(Effect.provide(fixture(() => row())))
  );
  for (const source of [
    row({ customer: { id: "someone-else" } }),
    row({ businessUnit: { key: "company-key" } }),
    row({ store: { key: "another-store" } }),
  ]) {
    it.effect(
      `hides a personal list outside buyer/Store scope: ${JSON.stringify(source.customer)}/${JSON.stringify(source.store)}/${"businessUnit" in source}`,
      () =>
        Effect.gen(function* () {
          expect(yield* (yield* ShoppingLists).get(buyer, target)).toEqual(
            Option.none()
          );
        }).pipe(Effect.provide(fixture(() => source)))
    );
  }
  it.effect("uses the selected Associate context for company lists", () =>
    Effect.gen(function* () {
      const found = Option.getOrThrow(
        yield* (yield* ShoppingLists).get(company, target)
      );
      expect(found.ownership).toEqual({
        _tag: "BusinessUnit",
        businessUnitId: "company-id",
        authUserId: buyer.authUserId,
      });
    }).pipe(
      Effect.provide(
        fixture(({ uri }) => {
          expect(uri).toContain(
            "/as-associate/buyer/in-business-unit/key=company-key/shopping-lists"
          );
          const where = new URL(uri, "https://example.test").searchParams
            .getAll("where")
            .join(" ");
          expect(where).toContain('id="list"');
          expect(where).toContain('store(key="store")');
          return { results: [row({ businessUnit: { key: "company-key" } })] };
        })
      )
    )
  );
  it.effect(
    "creates native exact-variant lines and combines duplicate additions",
    () =>
      Effect.gen(function* () {
        const created = yield* (yield* ShoppingLists).create(buyer, {
          storeKey: target.storeKey,
          name: { en: "Weekly" },
          items: [
            { variantId: variantReference("product", 2), quantity: 2 },
            { variantId: variantReference("product", 2), quantity: 3 },
          ],
        });
        expect(created.items[0]?.quantity).toBe(5);
      }).pipe(
        Effect.provide(
          fixture(({ body, uri }) => {
            expect(uri).toContain("/in-store/key=store/shopping-lists");
            expect(body).toMatchObject({
              customer: { id: "buyer" },
              lineItems: [{ productId: "product", variantId: 2, quantity: 5 }],
            });
            return row({ lineItems: [{ ...row().lineItems[0], quantity: 5 }] });
          })
        )
      )
  );
  it.effect(
    "updates a native line by its ID and preserves other translations",
    () =>
      Effect.gen(function* () {
        const changed = yield* (yield* ShoppingLists).update(buyer, {
          ...target,
          expectedRevision: ShoppingListRevision.make("1"),
          actions: [
            { _tag: "SetName", locale: "en", value: "Replenishment" },
            {
              _tag: "SetQuantity",
              lineItemId: ShoppingListLineItemId.make("line"),
              quantity: 7,
            },
          ],
        });
        expect(changed.revision).toBe("2");
      }).pipe(
        Effect.provide(
          fixture(({ body, method }) => {
            if (method === "GET") return row();
            expect(body).toEqual({
              version: 1,
              actions: [
                {
                  action: "changeName",
                  name: { en: "Replenishment", fr: "Hebdomadaire" },
                },
                {
                  action: "changeLineItemQuantity",
                  lineItemId: "line",
                  quantity: 7,
                },
              ],
            });
            return row({ version: 2 });
          })
        )
      )
  );
  it.effect("rejects stale changes without issuing a native write", () =>
    Effect.gen(function* () {
      const error = yield* (yield* ShoppingLists)
        .update(buyer, {
          ...target,
          expectedRevision: ShoppingListRevision.make("1"),
          actions: [{ _tag: "SetName", locale: "en", value: "Stale" }],
        })
        .pipe(Effect.flip);
      expect(error.reason).toBe("conflict");
    }).pipe(
      Effect.provide(
        fixture(({ method }) => {
          expect(method).toBe("GET");
          return row({ version: 2 });
        })
      )
    )
  );
  it.effect(
    "queries scoped company summaries with cursor predicates instead of offsets",
    () =>
      Effect.gen(function* () {
        const page = yield* (yield* ShoppingLists).list(company, {
          storeKey: target.storeKey,
          ownership: "others",
          limit: 2,
          cursor: JSON.stringify({
            id: "cursor-list",
            createdAt: "2026-11-03T00:00:00.000Z",
          }),
        });
        expect(page.items).toHaveLength(0);
      }).pipe(
        Effect.provide(
          fixture(({ uri }) => {
            const query = new URL(uri, "https://example.test").searchParams;
            const predicates = query.getAll("where").join(" ");
            expect(predicates).toContain('businessUnit(key="company-key")');
            expect(predicates).toContain('store(key="store")');
            expect(predicates).toContain('customer(id!="buyer")');
            expect(predicates).toContain('id < "cursor-list"');
            expect(query.has("offset")).toBe(false);
            return { results: [] };
          })
        )
      )
  );
});
