import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { describe, expect, it } from "@effect/vitest";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  B2CPurchasingPrincipal,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { EmailOrderAccess } from "@repo/commerce-core/domain/order-access";
import {
  FindOrderDetailInput,
  ListOrdersInput,
} from "@repo/commerce-core/domain/order-history";
import { OrderId } from "@repo/commerce-core/domain/order-identity";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { CommerceLocale, StoreKey } from "@repo/commerce-core/store";
import { Effect, Option, Redacted, Schema } from "effect";

import { orderMoney } from "./amounts";
import { orderQueriesLayerFrom } from "./queries";

const customer = new B2CPurchasingPrincipal({
  authUserId: AuthUserId.make("user-1"),
  customerId: CommerceCustomerId.make("customer-1"),
});
const company = new CustomerCommercePrincipal({
  authUserId: customer.authUserId,
  businessUnitId: CommerceBusinessUnitId.make("unit-1"),
  businessUnitKey: CommerceBusinessUnitKey.make("unit-key"),
  customerId: customer.customerId,
  roles: ["buyer"],
});
const input = Schema.decodeUnknownSync(ListOrdersInput)({
  limit: 2,
  locale: "en-US",
  stores: { _tag: "AllStores" },
});
const money = {
  centAmount: 12_345,
  currencyCode: "BHD",
  fractionDigits: 3,
  type: "centPrecision",
} as const;
const usd = (centAmount: number) => ({
  type: "centPrecision",
  fractionDigits: 2,
  currencyCode: "USD",
  centAmount,
});
const order = (overrides = {}) => ({
  createdAt: "2026-10-20T10:00:00Z",
  customLineItems: [],
  customerEmail: "buyer@example.test",
  customerId: "customer-1",
  id: "order-1",
  lastModifiedAt: "2026-10-21T10:00:00Z",
  lineItems: [],
  orderNumber: "R-1001",
  orderState: "Confirmed",
  paymentState: "Paid",
  shipmentState: "Shipped",
  store: { key: "origin" },
  totalPrice: money,
  ...overrides,
});
const detailInput = Schema.decodeUnknownSync(FindOrderDetailInput)({
  id: "order-1",
  locale: "en-US",
  stores: { _tag: "AllStores" },
});
const fixture = (read: (uri: string) => object) => {
  // The real SDK builds paths/query predicates; only its transport is replaced.
  const root = createApiBuilderFromCtpClient({
    execute: async (request: { readonly uri: string }) =>
      await Promise.resolve({
        body: read(request.uri),
        statusCode: 200,
      }),
  }).withProjectKey({ projectKey: "project" });
  return orderQueriesLayerFrom(root);
};

describe("commercetools order history", () => {
  const emailAccess = new EmailOrderAccess({
    orderId: OrderId.make("order-1"),
    recipient: Redacted.make("buyer@example.test", { label: "email" }),
    storeKey: StoreKey.make("origin"),
  });
  it.effect(
    "reads one personal Order through verified email access without a customer session",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).findById(
          emailAccess,
          detailInput
        );
        expect(Option.getOrThrow(result).id).toBe("order-1");
      }).pipe(Effect.provide(fixture(() => order({ customerId: undefined }))))
  );

  for (const value of [
    order({ customerEmail: "changed@example.test" }),
    order({ businessUnit: { key: "company" } }),
    order({ store: { key: "other" } }),
    order({ id: "other-order" }),
  ]) {
    it.effect(
      `rejects email access outside the recorded recipient, Order and personal Store scope: ${value.id}/${value.customerEmail}/${value.store.key}/${"businessUnit" in value}`,
      () =>
        Effect.gen(function* () {
          expect(
            Option.isNone(
              yield* (yield* OrderQueries).findById(emailAccess, detailInput)
            )
          ).toBeTruthy();
        }).pipe(Effect.provide(fixture(() => value)))
    );
  }

  it.effect(
    "queries personal ownership independently of locale and retains original currency",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).list(customer, input);
        expect(result.items[0]?.total.money).toEqual({
          amount: "12.345",
          currencyCode: "BHD",
        });
      }).pipe(
        Effect.provide(
          fixture((uri) => {
            const where = new URL(uri, "https://example.test").searchParams
              .getAll("where")
              .join(" ");
            expect(where).toContain(
              'customerId="customer-1" and businessUnit is not defined'
            );
            expect(where).not.toContain("store(");
            return { results: [order()] };
          })
        )
      )
  );
  it.effect(
    "filters a selected Store and company while including a colleague's order",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).list(company, {
          ...input,
          stores: { _tag: "SingleStore", storeKey: StoreKey.make("origin") },
        });
        expect(result.items).toHaveLength(1);
      }).pipe(
        Effect.provide(
          fixture((uri) => {
            expect(decodeURIComponent(uri)).toContain(
              'businessUnit(key="unit-key")'
            );
            return {
              results: [
                order({
                  businessUnit: { key: "unit-key" },
                  customerId: "colleague",
                  store: { key: "origin" },
                }),
              ],
            };
          })
        )
      )
  );
  it.effect("does not expose a detail ID owned by a different customer", () =>
    Effect.gen(function* () {
      const result = yield* (yield* OrderQueries).findById(
        customer,
        detailInput
      );
      expect(Option.isNone(result)).toBeTruthy();
    }).pipe(Effect.provide(fixture(() => order({ customerId: "other" }))))
  );
  it.effect(
    "reads custom historical items and partial addresses without current product data",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).findById(
          customer,
          detailInput
        );
        expect(Option.isSome(result)).toBeTruthy();
        if (Option.isSome(result)) {
          expect(result.value.lineItems[0]).toMatchObject({
            name: "Recorded service",
            orderedQuantity: 1,
          });
          expect(result.value.shippingAddress?.addressLine1).toBe(
            "14 High Street"
          );
        }
      }).pipe(
        Effect.provide(
          fixture(() =>
            order({
              customLineItems: [
                {
                  id: "service",
                  name: { "en-US": "Recorded service" },
                  quantity: 1,
                  totalPrice: money,
                },
              ],
              shippingAddress: { country: "GB", streetName: "14 High Street" },
            })
          )
        )
      )
  );
  it.effect("reads named selections from recorded variant attributes", () =>
    Effect.gen(function* () {
      const result = Option.getOrThrow(
        yield* (yield* OrderQueries).findById(customer, {
          ...detailInput,
          locale: CommerceLocale.make("fr-FR"),
        })
      );
      expect(result.lineItems[0]?.variantOptions).toEqual([
        { name: "Taille", value: "L" },
        { name: "Couleur", value: "Bleu historique" },
      ]);
      expect(result.lineItems[1]?.variantOptions).toBeUndefined();
    }).pipe(
      Effect.provide(
        fixture((uri) => {
          expect(
            new URL(uri, "https://example.test").searchParams.getAll("expand")
          ).toContain("lineItems[*].productType");
          const line = {
            id: "jacket",
            productId: "product-1",
            name: { "fr-FR": "Veste" },
            quantity: 1,
            totalPrice: money,
            productType: {
              typeId: "product-type",
              id: "type-1",
              obj: { key: "outdoor-product" },
            },
            variant: {
              id: 1,
              attributes: [
                { name: "size", value: { key: "L", label: "L" } },
                {
                  name: "color",
                  value: {
                    key: "old-blue",
                    label: {
                      "fr-FR": "Bleu historique",
                      "en-US": "Recorded blue",
                    },
                  },
                },
                { name: "material", value: "Cotton" },
              ],
            },
          };
          return order({
            lineItems: [
              line,
              {
                ...line,
                id: "deleted-type",
                productType: { typeId: "product-type", id: "removed-type" },
              },
            ],
          });
        })
      )
    )
  );

  it.effect(
    "reads company financial observations from native totals, discounts and Payments",
    () => {
      const taxed = (net: number, tax: number) => ({
        totalNet: usd(net),
        totalTax: usd(tax),
        totalGross: usd(net + tax),
        taxPortions: [],
      });
      const line = {
        id: "jacket",
        productId: "product-1",
        productType: { typeId: "product-type", id: "type-1" },
        name: { "en-US": "Recorded jacket" },
        quantity: 2,
        variant: { id: 1 },
        price: { value: usd(6000), discounted: { value: usd(5500) } },
        totalPrice: usd(10_000),
        taxedPrice: taxed(9000, 1800),
        discountedPricePerQuantity: [
          {
            quantity: 2,
            discountedPrice: {
              includedDiscounts: [{ discountedAmount: usd(500) }],
            },
          },
        ],
      };
      const native = order({
        businessUnit: { key: company.businessUnitKey },
        totalPrice: usd(11_700),
        taxedPrice: taxed(11_700, 2340),
        taxedShippingPrice: taxed(1800, 360),
        discountOnTotalPrice: { discountedAmount: usd(1300) },
        lineItems: [line],
        customLineItems: [
          {
            id: "service",
            name: { "en-US": "Service" },
            quantity: 1,
            totalPrice: usd(1000),
            taxedPrice: taxed(900, 180),
          },
        ],
        shippingMode: "Multiple",
        shipping: [
          {
            shippingInfo: {
              price: usd(1500),
              discountedPrice: {
                value: usd(1000),
                includedDiscounts: [{ discountedAmount: usd(500) }],
              },
            },
          },
          { shippingInfo: { price: usd(1000) } },
        ],
        paymentInfo: {
          payments: [
            {
              id: "payment-1",
              obj: {
                id: "payment-1",
                transactions: [
                  { type: "Charge", state: "Success", amount: usd(14_040) },
                  { type: "Refund", state: "Success", amount: usd(2040) },
                  { type: "Charge", state: "Pending", amount: usd(99_999) },
                ],
              },
            },
          ],
        },
      });
      return Effect.gen(function* () {
        const result = Option.getOrThrow(
          yield* (yield* OrderQueries).findById(company, detailInput)
        );
        expect(result.amounts).toMatchObject({
          subtotal: {
            money: { amount: "99.00", currencyCode: "USD" },
            taxIncluded: "no",
          },
          shipping: {
            money: { amount: "18.00", currencyCode: "USD" },
            taxIncluded: "no",
          },
          tax: { amount: "23.40" },
          discounts: { amount: "38.00" },
          paidBeforeRefunds: { amount: "140.40" },
          refunded: { amount: "20.40" },
          outstanding: { amount: "0.00" },
        });
        expect(result.total.money.amount).toBe("140.40");
        expect(
          result.lineItems.map((item) => item.total?.money.amount)
        ).toEqual(["90.00", "9.00"]);
      }).pipe(
        Effect.provide(
          fixture((uri) => {
            expect(
              new URL(uri, "https://example.test").searchParams.getAll("expand")
            ).toContain("paymentInfo.payments[*]");
            return native;
          })
        )
      );
    }
  );

  it.effect(
    "reports a personal order's balance from successful charges across Payments",
    () => {
      const native = order({
        paymentState: "BalanceDue",
        paymentInfo: {
          payments: [
            {
              id: "one",
              obj: {
                id: "one",
                transactions: [
                  {
                    type: "Charge",
                    state: "Success",
                    amount: { ...money, centAmount: 2345 },
                  },
                ],
              },
            },
            {
              id: "two",
              obj: {
                id: "two",
                transactions: [
                  {
                    type: "Charge",
                    state: "Success",
                    amount: { ...money, centAmount: 1000 },
                  },
                  { type: "Charge", state: "Failure", amount: money },
                ],
              },
            },
          ],
        },
      });
      return Effect.gen(function* () {
        const result = Option.getOrThrow(
          yield* (yield* OrderQueries).findById(customer, detailInput)
        );
        expect(result.amounts).toMatchObject({
          paidBeforeRefunds: { amount: "3.345", currencyCode: "BHD" },
          outstanding: { amount: "9.000", currencyCode: "BHD" },
        });
      }).pipe(Effect.provide(fixture(() => native)));
    }
  );

  it.effect(
    "keeps unavailable payment amounts unknown and preserves native decimal discount scales",
    () => {
      const native = order({
        customLineItems: [
          {
            id: "service",
            name: { "en-US": "Service" },
            quantity: 3,
            totalPrice: money,
            discountedPricePerQuantity: [
              {
                quantity: 3,
                discountedPrice: {
                  includedDiscounts: [
                    {
                      discountedAmount: {
                        type: "highPrecision",
                        fractionDigits: 4,
                        currencyCode: "BHD",
                        centAmount: 125,
                        preciseAmount: 1250,
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
        paymentInfo: { payments: [{ id: "unavailable" }] },
      });
      return Effect.gen(function* () {
        const result = Option.getOrThrow(
          yield* (yield* OrderQueries).findById(customer, detailInput)
        );
        expect(result.amounts.discounts).toEqual({
          amount: "0.3750",
          currencyCode: "BHD",
        });
        expect(result.amounts.paidBeforeRefunds).toBeUndefined();
        expect(result.amounts.refunded).toBeUndefined();
        expect(result.amounts.outstanding).toBeUndefined();
      }).pipe(Effect.provide(fixture(() => native)));
    }
  );

  it.effect(
    "leaves a refunded order's balance unknown when native records do not establish a new debt",
    () =>
      Effect.gen(function* () {
        const result = Option.getOrThrow(
          yield* (yield* OrderQueries).findById(customer, detailInput)
        );
        expect(result.amounts.refunded?.amount).toBe("1.000");
        expect(result.amounts.outstanding).toBeUndefined();
      }).pipe(
        Effect.provide(
          fixture(() =>
            order({
              paymentState: "BalanceDue",
              paymentInfo: {
                payments: [
                  {
                    id: "payment",
                    obj: {
                      id: "payment",
                      transactions: [
                        { type: "Charge", state: "Success", amount: money },
                        {
                          type: "Refund",
                          state: "Success",
                          amount: { ...money, centAmount: 1000 },
                        },
                      ],
                    },
                  },
                ],
              },
            })
          )
        )
      )
  );

  it.effect(
    "does not count a Product Discount that lost the native Best Deal selection",
    () =>
      Effect.gen(function* () {
        const result = Option.getOrThrow(
          yield* (yield* OrderQueries).findById(customer, detailInput)
        );
        expect(result.amounts.discounts?.amount).toBe("1.000");
      }).pipe(
        Effect.provide(
          fixture(() =>
            order({
              discountTypeCombination: {
                type: "BestDeal",
                chosenDiscountType: "CartDiscount",
              },
              lineItems: [
                {
                  id: "item",
                  productId: "product",
                  productType: { id: "type" },
                  name: { "en-US": "Item" },
                  variant: { id: 1 },
                  quantity: 1,
                  price: {
                    value: money,
                    discounted: { value: { ...money, centAmount: 12_000 } },
                  },
                  totalPrice: money,
                  discountedPricePerQuantity: [
                    {
                      quantity: 1,
                      discountedPrice: {
                        includedDiscounts: [
                          { discountedAmount: { ...money, centAmount: 1000 } },
                        ],
                      },
                    },
                  ],
                },
              ],
            })
          )
        )
      )
  );

  for (const shipmentState of ["Shipped", "Delivered"] as const) {
    it.effect(
      `maps recorded ${shipmentState} deliveries and excludes return tracking`,
      () =>
        Effect.gen(function* () {
          const result = Option.getOrThrow(
            yield* (yield* OrderQueries).findById(customer, detailInput)
          );
          expect(result.fulfillments[0]).toMatchObject({
            status: "fulfilled",
            deliveryStatus:
              shipmentState === "Delivered" ? "delivered" : "inTransit",
            tracking: [{ carrier: "UPS", number: "outbound" }],
          });
        }).pipe(
          Effect.provide(
            fixture(() =>
              order({
                shipmentState,
                shippingInfo: {
                  price: money,
                  deliveries: [
                    {
                      id: "delivery-1",
                      items: [],
                      parcels: [
                        {
                          trackingData: {
                            carrier: "UPS",
                            trackingId: "outbound",
                          },
                        },
                        {
                          trackingData: {
                            carrier: "UPS",
                            trackingId: "return",
                            isReturn: true,
                          },
                        },
                      ],
                    },
                  ],
                },
              })
            )
          )
        )
    );
  }

  it.effect(
    "leaves fulfillment unknown when the shipment state gives no shipped quantities",
    () =>
      Effect.gen(function* () {
        const result = Option.getOrThrow(
          yield* (yield* OrderQueries).findById(customer, detailInput)
        );
        expect(result.status.fulfillment).toBe("unknown");
        expect(result.fulfillments[0]).toMatchObject({
          status: "unknown",
          deliveryStatus: "unknown",
        });
      }).pipe(
        Effect.provide(
          fixture(() =>
            order({
              shipmentState: "Partial",
              shippingInfo: {
                price: money,
                deliveries: [{ id: "delivery-1", items: [], parcels: [] }],
              },
            })
          )
        )
      )
  );

  it.effect(
    "binds keyset continuations to the reader and rejects a different company",
    () =>
      Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const first = yield* queries.list(customer, input);
        expect(first.nextCursor).toBeDefined();
        const error = yield* queries
          .list(company, { ...input, after: first.nextCursor })
          .pipe(Effect.flip);
        expect(error.reason).toBe("invalidCursor");
      }).pipe(
        Effect.provide(
          fixture(() => ({
            results: [
              order(),
              order({ id: "order-2" }),
              order({ id: "order-3" }),
            ],
          }))
        )
      )
  );

  it.effect(
    "filters PO numbers beyond the first native page without skipping remaining matches",
    () => {
      let calls = 0;
      return Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const selected = Schema.decodeUnknownSync(ListOrdersInput)({
          ...input,
          filters: {
            createdBefore: "2026-11-01T00:00:00Z",
            createdFrom: "2026-10-01T00:00:00Z",
            fulfillment: "fulfilled",
            payment: "paid",
            purchaseOrderNumber: "PO-42",
          },
        });
        const first = yield* queries.list(company, selected);
        expect(first.items.map((item) => item.id)).toEqual([
          "order-8",
          "order-7",
        ]);
        expect(calls).toBe(2);
        const next = yield* queries.list(company, {
          ...selected,
          after: first.nextCursor,
        });
        expect(next.items.map((item) => item.id)).toEqual(["order-6"]);
        expect(next.nextCursor).toBeUndefined();
      }).pipe(
        Effect.provide(
          fixture((uri) => {
            calls += 1;
            const query = new URL(uri, "https://example.test");
            const where = query.searchParams.getAll("where").join(" ");
            expect(where).toContain('businessUnit(key="unit-key")');
            expect(where).toContain('createdAt>="2026-10-01T00:00:00.000Z"');
            expect(where).toContain('paymentState in ("Paid")');
            const native = (id: string, po = "PO-42") =>
              order({
                businessUnit: { key: "unit-key" },
                id,
                purchaseOrderNumber: po,
              });
            if (where.includes('id<"order-7"')) {
              return { results: [native("order-6")] };
            }
            if (where.includes('id<"order-8"')) {
              return { results: [native("order-7"), native("order-6")] };
            }
            return {
              results: [
                native("order-9", "other"),
                native("order-8"),
                native("order-7"),
              ],
            };
          })
        )
      );
    }
  );

  it.effect(
    "bounds sparse searches and binds their continuations to the filters",
    () => {
      let calls = 0;
      return Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const selected = Schema.decodeUnknownSync(ListOrdersInput)({
          ...input,
          filters: { purchaseOrderNumber: "missing" },
        });
        const page = yield* queries.list(customer, selected);
        expect(page.items).toHaveLength(0);
        expect(page.nextCursor).toBeDefined();
        expect(calls).toBe(5);
        const error = yield* queries
          .list(customer, {
            ...selected,
            after: page.nextCursor,
            filters: { purchaseOrderNumber: "another" },
          })
          .pipe(Effect.flip);
        expect(error.reason).toBe("invalidCursor");
        expect(calls).toBe(5);
      }).pipe(
        Effect.provide(
          fixture(() => {
            calls += 1;
            return {
              results: [
                order({ id: `a-${calls}` }),
                order({ id: `b-${calls}` }),
                order({ id: `c-${calls}` }),
              ],
            };
          })
        )
      );
    }
  );

  it("converts zero-decimal and high precision amounts without assuming cents", () => {
    expect(
      orderMoney({
        ...money,
        centAmount: 1234,
        currencyCode: "JPY",
        fractionDigits: 0,
      })
    ).toEqual({ amount: "1234", currencyCode: "JPY" });
    expect(
      orderMoney({
        ...money,
        fractionDigits: 6,
        preciseAmount: 123_456_789,
        type: "highPrecision",
      })
    ).toEqual({ amount: "123.456789", currencyCode: "BHD" });
  });
});
