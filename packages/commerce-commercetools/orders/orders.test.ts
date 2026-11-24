/* oxlint-disable typescript/promise-function-async -- Provider contract doubles return settled Promises. */
import type {
  ByProjectKeyRequestBuilder,
  OrderFromCartDraft,
} from "@commercetools/platform-sdk";
import { CartId } from "@repo/commerce-core/domain/cart";
import {
  StorefrontAnonymousCheckoutScope,
  StorefrontCustomerCheckoutScope,
  StorefrontB2CCheckoutScope,
} from "@repo/commerce-core/domain/checkout";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import { OrderId } from "@repo/commerce-core/domain/order";
import { Orders } from "@repo/commerce-core/services/orders";
import { CommerceLocale, StoreKey } from "@repo/commerce-core/store";
import { PaymentReference } from "@repo/payments";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { ordersLayerFrom } from "./orders";

const cartId = CartId.make("cart-from-input");
const totalPrice = { centAmount: 1_700_000, currencyCode: "USD" } as const;
const paymentReference = PaymentReference.make("payment-from-input");
const anonymousScope = new StorefrontAnonymousCheckoutScope({
  anonymousCartId: cartId,
  channel: "storefrontAnonymous",
  locale: CommerceLocale.make("en-US"),
});
const consumedAnonymousCartScope = new StorefrontAnonymousCheckoutScope({
  channel: "storefrontAnonymous",
  locale: CommerceLocale.make("en-US"),
});
const customerScope = new StorefrontCustomerCheckoutScope({
  businessUnitId: CommerceBusinessUnitId.make("business-unit-from-input"),
  businessUnitKey: CommerceBusinessUnitKey.make("business-unit-key-from-input"),
  channel: "storefrontCustomer",
  customerId: CommerceCustomerId.make("customer-from-input"),
  locale: CommerceLocale.make("en-US"),
});
const cart = {
  taxMode: "Disabled",
  cartState: "Active",
  customerId: undefined,
  id: cartId,
  paymentInfo: { payments: [{ id: paymentReference, typeId: "payment" }] },
  totalPrice,
  version: 7,
};
const order = {
  taxMode: "Disabled",
  cart: { id: cartId, typeId: "cart" },
  id: "order-from-provider",
  orderNumber: `checkout-${cartId}`,
  paymentInfo: { payments: [{ id: paymentReference, typeId: "payment" }] },
  totalPrice,
};
const notFound = () =>
  Promise.reject(
    Object.assign(new Error("Order not found"), { statusCode: 404 })
  );

const apiRootFrom = ({
  createOrder = () => Promise.resolve({ body: order }),
  cartOverrides = {},
  findOrderById = notFound,
  findOrder = notFound,
}: {
  readonly createOrder?: () => Promise<object>;
  readonly cartOverrides?: object;
  readonly findOrderById?: () => Promise<object>;
  readonly findOrder?: () => Promise<object>;
} = {}) => {
  let submittedOrder: OrderFromCartDraft | undefined;
  const apiRoot = {
    carts: () => ({
      withId: () => ({
        get: () => ({
          execute: () =>
            Promise.resolve({ body: { ...cart, ...cartOverrides } }),
        }),
      }),
    }),
    orders: () => ({
      post: ({ body }: { readonly body: OrderFromCartDraft }) => ({
        execute: () => {
          submittedOrder = body;
          return createOrder();
        },
      }),
      withId: () => ({ get: () => ({ execute: findOrderById }) }),
      withOrderNumber: () => ({ get: () => ({ execute: findOrder }) }),
    }),
  };
  return {
    // SAFETY: The adapter consumes only the Cart and Order request-builder
    // methods implemented by this contract double.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
    apiRoot: apiRoot as unknown as ByProjectKeyRequestBuilder,
    submittedOrder: () => submittedOrder,
  };
};

describe("Commercetools Orders", () => {
  it("validates and returns the tax-inclusive amount for Order creation and recovery", async () => {
    const gross = { ...totalPrice, centAmount: totalPrice.centAmount + 2000 };
    const taxedPrice = {
      totalGross: gross,
      totalNet: totalPrice,
      totalTax: { ...totalPrice, centAmount: 2000 },
    };
    const taxedOrder = { ...order, taxMode: "Platform", taxedPrice };
    const { apiRoot } = apiRootFrom({
      cartOverrides: { taxMode: "Platform", taxedPrice },
      createOrder: () => Promise.resolve({ body: taxedOrder }),
      findOrder: () => Promise.resolve({ body: taxedOrder }),
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        const input = {
          cartId,
          paymentReference,
          scope: anonymousScope,
          totalPrice: gross,
        };
        yield* orders.validateCart(input);
        expect((yield* orders.place(input)).totalPrice).toEqual(gross);
        expect(Option.getOrThrow(yield* orders.find(input)).totalPrice).toEqual(
          gross
        );
        expect(
          yield* orders.validateCart({ ...input, totalPrice }).pipe(Effect.flip)
        ).toMatchObject({
          _tag: "OrderPlacementRejected",
          reason: "cartChanged",
        });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );
  });

  it("rejects an unresolved native tax calculation before payment authorization", async () => {
    const { apiRoot, submittedOrder } = apiRootFrom({
      cartOverrides: { taxMode: "Platform" },
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        expect(
          yield* orders
            .validateCart({
              cartId,
              paymentReference,
              scope: anonymousScope,
              totalPrice,
            })
            .pipe(Effect.flip)
        ).toMatchObject({
          _tag: "OrderPlacementRejected",
          reason: "invalidCart",
        });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );
    expect(submittedOrder()).toBeUndefined();
  });

  it.each([
    "DoesNotMatchCart",
    "NotActive",
    "NotValid",
    "MaxApplicationReached",
    "ApplicationStoppedByPreviousDiscount",
  ])(
    "rejects %s discount codes during validation and placement",
    async (state) => {
      const { apiRoot, submittedOrder } = apiRootFrom({
        cartOverrides: {
          discountCodes: [
            { discountCode: { id: "code-1", typeId: "discount-code" }, state },
          ],
        },
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          const orders = yield* Orders;
          const input = {
            cartId,
            paymentReference,
            scope: anonymousScope,
            totalPrice,
          };
          expect(
            yield* orders.validateCart(input).pipe(Effect.flip)
          ).toMatchObject({
            _tag: "OrderPlacementRejected",
            reason: "invalidCart",
          });
          expect(yield* orders.place(input).pipe(Effect.flip)).toMatchObject({
            _tag: "OrderPlacementRejected",
            reason: "invalidCart",
          });
        }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
      );
      expect(submittedOrder()).toBeUndefined();
    }
  );

  it.each(["MatchesCart", "ApplicationStoppedByGroupBestDeal"])(
    "allows %s discount codes during validation and placement",
    async (state) => {
      const { apiRoot, submittedOrder } = apiRootFrom({
        cartOverrides: {
          discountCodes: [
            { discountCode: { id: "code-1", typeId: "discount-code" }, state },
          ],
        },
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          const orders = yield* Orders;
          const input = {
            cartId,
            paymentReference,
            scope: anonymousScope,
            totalPrice,
          };
          yield* orders.validateCart(input);
          yield* orders.place(input);
        }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
      );
      expect(submittedOrder()).toBeDefined();
    }
  );

  it("maps a discount code becoming inapplicable during placement to a definitive rejection", async () => {
    const { apiRoot } = apiRootFrom({
      createOrder: () =>
        Promise.reject(
          Object.assign(new Error("Code expired"), {
            body: { errors: [{ code: "DiscountCodeNonApplicable" }] },
            statusCode: 400,
          })
        ),
    });
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        const input = {
          cartId,
          paymentReference,
          scope: anonymousScope,
          totalPrice,
        };
        yield* orders.validateCart(input);
        return yield* orders.place(input).pipe(Effect.flip);
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );
    expect(failure).toMatchObject({
      _tag: "OrderPlacementRejected",
      reason: "invalidCart",
    });
  });

  it("creates an Order from the asserted Cart version and deterministic number", async () => {
    const { apiRoot, submittedOrder } = apiRootFrom();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders.place({
          cartId,
          paymentReference,
          scope: anonymousScope,
          totalPrice,
        });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(result).toStrictEqual({
      cartId,
      id: "order-from-provider",
      number: `checkout-${cartId}`,
      paymentReference,
      totalPrice,
    });
    expect(submittedOrder()).toStrictEqual({
      cart: { id: cartId, typeId: "cart" },
      orderNumber: `checkout-${cartId}`,
      version: 7,
    });
  });

  it("recovers the created Order after losing the create response", async () => {
    const { apiRoot } = apiRootFrom({
      createOrder: () => Promise.reject(new Error("response lost")),
      findOrder: () => Promise.resolve({ body: order }),
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders.place({
          cartId,
          paymentReference,
          scope: anonymousScope,
          totalPrice,
        });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(result.id).toBe("order-from-provider");
  });

  it("maps a definitive inventory rejection after recovery finds no Order", async () => {
    const { apiRoot } = apiRootFrom({
      createOrder: () =>
        Promise.reject(
          Object.assign(new Error("Cart inventory changed"), {
            body: { errors: [{ code: "OutOfStock" }] },
            statusCode: 400,
          })
        ),
    });

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders
          .place({
            cartId,
            paymentReference,
            scope: anonymousScope,
            totalPrice,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(failure).toMatchObject({
      _tag: "OrderPlacementRejected",
      reason: "outOfStock",
    });
  });

  it("maps a concurrent Cart change to a definitive placement rejection", async () => {
    const { apiRoot } = apiRootFrom({
      createOrder: () =>
        Promise.reject(
          Object.assign(new Error("Cart version changed"), {
            body: { errors: [{ code: "ConcurrentModification" }] },
            statusCode: 409,
          })
        ),
    });

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders
          .place({
            cartId,
            paymentReference,
            scope: anonymousScope,
            totalPrice,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(failure).toMatchObject({
      _tag: "OrderPlacementRejected",
      reason: "cartChanged",
    });
  });

  it("pretends an Order outside the current customer authority does not exist", async () => {
    const { apiRoot } = apiRootFrom({
      findOrder: () =>
        Promise.resolve({
          body: {
            ...order,
            businessUnit: {
              key: "another-business-unit",
              typeId: "business-unit",
            },
            customerId: "another-customer",
          },
        }),
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders.find({ cartId, scope: customerScope });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(Option.isNone(result)).toBeTruthy();
  });

  it("reads an Order by ID only for the current Checkout authority", async () => {
    const { apiRoot } = apiRootFrom({
      findOrderById: () => Promise.resolve({ body: order }),
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders.findById({
          anonymousAccess: {
            cartId,
            orderId: OrderId.make("order-from-provider"),
          },
          id: OrderId.make("order-from-provider"),
          scope: consumedAnonymousCartScope,
        });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(Option.getOrThrow(result)).toStrictEqual({
      cartId,
      id: "order-from-provider",
      number: `checkout-${cartId}`,
      paymentReference,
      totalPrice,
    });
  });

  it("keeps unclassified CommerceTools client failures as provider defects", async () => {
    const { apiRoot } = apiRootFrom({
      createOrder: () =>
        Promise.reject(
          Object.assign(new Error("CommerceTools credentials were rejected"), {
            statusCode: 401,
          })
        ),
    });

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders
          .place({
            cartId,
            paymentReference,
            scope: anonymousScope,
            totalPrice,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(failure).toMatchObject({
      _tag: "OrderProviderFailure",
      reason: "unexpectedResponse",
    });
  });

  it("pretends an anonymous Order without matching Order access does not exist", async () => {
    const { apiRoot } = apiRootFrom({
      findOrderById: () => Promise.resolve({ body: order }),
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const orders = yield* Orders;
        return yield* orders.findById({
          id: OrderId.make("order-from-provider"),
          scope: anonymousScope,
        });
      }).pipe(Effect.provide(ordersLayerFrom(apiRoot)))
    );

    expect(Option.isNone(result)).toBeTruthy();
  });
});

describe("personal Order authority", () => {
  const scope = new StorefrontB2CCheckoutScope({
    channel: "storefrontPersonal",
    customerId: CommerceCustomerId.make("personal-customer"),
    locale: CommerceLocale.make("en-US"),
    storeKey: StoreKey.make("personal-store"),
  });
  const b2cOrder = {
    ...order,
    customerId: "personal-customer",
    store: { key: "personal-store" },
  };

  it("places an Order using a personal Customer cart", async () => {
    const { apiRoot } = apiRootFrom({
      cartOverrides: {
        customerId: "personal-customer",
        store: { key: "personal-store" },
      },
      createOrder: () => Promise.resolve({ body: b2cOrder }),
    });
    const result = await Effect.runPromise(
      Orders.pipe(
        Effect.flatMap((orders) =>
          orders.place({ cartId, paymentReference, totalPrice, scope })
        ),
        Effect.provide(ordersLayerFrom(apiRoot))
      )
    );
    expect(result.cartId).toBe(cartId);
  });

  it.each([
    { ...b2cOrder, customerId: "other" },
    { ...b2cOrder, store: { key: "other" } },
    { ...b2cOrder, businessUnit: { key: "company" } },
  ])(
    "does not expose a B2C Order outside its Customer, Store and purchasing context: %#",
    async (foreignOrder) => {
      const { apiRoot } = apiRootFrom({
        findOrderById: () => Promise.resolve({ body: foreignOrder }),
      });
      const result = await Effect.runPromise(
        Orders.pipe(
          Effect.flatMap((orders) =>
            orders.findById({ id: OrderId.make(order.id), scope })
          ),
          Effect.provide(ordersLayerFrom(apiRoot))
        )
      );
      expect(Option.isNone(result)).toBeTruthy();
    }
  );
});
