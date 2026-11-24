import type {
  ByProjectKeyRequestBuilder,
  Cart,
  Order,
  OrderFromCartDraft,
} from "@commercetools/platform-sdk";
import { CartId } from "@repo/commerce-core/domain/cart";
import type { OrderRecord } from "@repo/commerce-core/domain/order";
import {
  OrderId,
  OrderPlacementOutcomeUnknown,
  OrderPlacementRejected,
  OrderProviderFailure,
  orderNumberForCart,
} from "@repo/commerce-core/domain/order";
import { Orders } from "@repo/commerce-core/services/orders";
import type {
  FindOrderByIdInput,
  FindOrderInput,
  PlaceOrderInput,
} from "@repo/commerce-core/services/orders";
import { PaymentReference } from "@repo/payments";
import { Effect, Layer, Option, Schema } from "effect";

import { payableTotal } from "../cart/price";
import { CommercetoolsRestClient } from "../client/rest-client";
import {
  commercetoolsProviderFailureReason,
  hasCommercetoolsErrorCode,
} from "../client/versioned-write";

const orderFailure = (operation: string, cause: unknown) =>
  new OrderProviderFailure({
    cause,
    message: `CommerceTools ${operation} failed`,
    operation,
    reason: commercetoolsProviderFailureReason(cause),
  });

const ProviderHttpFailure = Schema.Struct({ statusCode: Schema.Finite });

const isNotFound = (error: OrderProviderFailure) =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(ProviderHttpFailure)(error.cause)
  )?.statusCode === 404;

const providerRequest = <A>(operation: string, request: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => orderFailure(operation, cause),
    try: request,
  });

const hasOrderAuthority = (order: Order, input: FindOrderInput) => {
  if (order.cart?.id !== input.cartId) {
    return false;
  }
  if (input.scope.channel === "storefrontAnonymous") {
    return input.scope.anonymousCartId === input.cartId;
  }
  if (input.scope.channel === "storefrontPersonal") {
    return (
      order.customerId === input.scope.customerId &&
      order.businessUnit === undefined &&
      order.store?.key === input.scope.storeKey
    );
  }
  return (
    order.businessUnit?.key === input.scope.businessUnitKey &&
    order.customerId === input.scope.customerId
  );
};

const hasOrderIdAuthority = (order: Order, input: FindOrderByIdInput) => {
  const cartId = order.cart?.id;
  if (cartId === undefined) {
    return false;
  }
  if (input.scope.channel === "storefrontAnonymous") {
    return (
      input.anonymousAccess?.orderId === input.id &&
      input.anonymousAccess.cartId === cartId
    );
  }
  if (input.scope.channel === "storefrontPersonal") {
    return (
      order.customerId === input.scope.customerId &&
      order.businessUnit === undefined &&
      order.store?.key === input.scope.storeKey
    );
  }
  return (
    order.businessUnit?.key === input.scope.businessUnitKey &&
    order.customerId === input.scope.customerId
  );
};

const orderSnapshot = (
  order: Order,
  cartId: CartId
): Effect.Effect<OrderRecord, OrderProviderFailure> => {
  const expectedNumber = orderNumberForCart(cartId);
  if (
    order.taxMode !== "Disabled" &&
    (order.taxedPrice === undefined || order.taxedPrice === null)
  ) {
    return Effect.fail(
      orderFailure(
        "order.read",
        new Error("Order tax calculation is unavailable")
      )
    );
  }
  const [payment] = order.paymentInfo?.payments ?? [];
  if (
    order.orderNumber !== expectedNumber ||
    payment === undefined ||
    order.paymentInfo?.payments.length !== 1
  ) {
    return Effect.fail(
      orderFailure(
        "order.read",
        new Error("Order does not belong to the current Checkout authority")
      )
    );
  }
  return Effect.succeed({
    cartId,
    id: OrderId.make(order.id),
    number: expectedNumber,
    paymentReference: PaymentReference.make(payment.id),
    totalPrice: payableTotal(order),
  });
};

const findOrder = (
  apiRoot: ByProjectKeyRequestBuilder,
  input: FindOrderInput
) =>
  providerRequest("order.read", async () => {
    const response = await apiRoot
      .orders()
      .withOrderNumber({ orderNumber: orderNumberForCart(input.cartId) })
      .get()
      .execute();
    return response.body;
  }).pipe(
    Effect.flatMap((order) =>
      hasOrderAuthority(order, input)
        ? orderSnapshot(order, input.cartId).pipe(Effect.map(Option.some))
        : Effect.succeed(Option.none())
    ),
    Effect.catch((error) =>
      isNotFound(error) ? Effect.succeed(Option.none()) : Effect.fail(error)
    )
  );

const findOrderById = (
  apiRoot: ByProjectKeyRequestBuilder,
  input: FindOrderByIdInput
) =>
  providerRequest("order.readById", async () => {
    const response = await apiRoot
      .orders()
      .withId({ ID: input.id })
      .get()
      .execute();
    return response.body;
  }).pipe(
    Effect.flatMap((order) => {
      const cartId = order.cart?.id;
      if (cartId === undefined || !hasOrderIdAuthority(order, input)) {
        return Effect.succeed(Option.none());
      }
      return orderSnapshot(order, CartId.make(cartId)).pipe(
        Effect.map(Option.some)
      );
    }),
    Effect.catch((error) =>
      isNotFound(error) ? Effect.succeed(Option.none()) : Effect.fail(error)
    )
  );

const hasCartAuthority = (cart: Cart, input: PlaceOrderInput) => {
  if (input.scope.channel === "storefrontAnonymous") {
    return (
      input.scope.anonymousCartId === input.cartId &&
      cart.customerId === undefined
    );
  }
  if (input.scope.channel === "storefrontPersonal") {
    return (
      cart.customerId === input.scope.customerId &&
      cart.businessUnit === undefined &&
      cart.store?.key === input.scope.storeKey
    );
  }
  return (
    cart.businessUnit?.key === input.scope.businessUnitKey &&
    cart.customerId === input.scope.customerId
  );
};

const requireOrderableCart = (
  cart: Cart,
  input: PlaceOrderInput
): Effect.Effect<Cart, OrderPlacementRejected> => {
  if (
    cart.id !== input.cartId ||
    cart.cartState !== "Active" ||
    !hasCartAuthority(cart, input) ||
    payableTotal(cart).centAmount !== input.totalPrice.centAmount ||
    payableTotal(cart).currencyCode !== input.totalPrice.currencyCode ||
    cart.paymentInfo?.payments.length !== 1 ||
    cart.paymentInfo.payments[0]?.id !== input.paymentReference
  ) {
    return Effect.fail(
      new OrderPlacementRejected({
        message: "The Checkout Cart changed before Order placement",
        reason: "cartChanged",
      })
    );
  }
  if (
    cart.taxMode !== "Disabled" &&
    (cart.taxedPrice === undefined || cart.taxedPrice === null)
  ) {
    return Effect.fail(
      new OrderPlacementRejected({
        message: "Tax must be calculated before authorizing payment",
        reason: "invalidCart",
      })
    );
  }
  if (
    cart.discountCodes?.some(
      ({ state }) =>
        state !== "MatchesCart" && state !== "ApplicationStoppedByGroupBestDeal"
    )
  ) {
    return Effect.fail(
      new OrderPlacementRejected({
        message:
          "Remove or adjust discount codes that do not apply before placing the Order",
        reason: "invalidCart",
      })
    );
  }
  return Effect.succeed(cart);
};

const rejectionFor = (cause: unknown): OrderPlacementRejected | undefined => {
  if (hasCommercetoolsErrorCode(cause, "DiscountCodeNonApplicable")) {
    return new OrderPlacementRejected({
      message: "A Cart discount code is no longer applicable",
      reason: "invalidCart",
    });
  }
  if (hasCommercetoolsErrorCode(cause, "ConcurrentModification")) {
    return new OrderPlacementRejected({
      message: "The Checkout Cart changed during Order placement",
      reason: "cartChanged",
    });
  }
  if (hasCommercetoolsErrorCode(cause, "OutOfStock")) {
    return new OrderPlacementRejected({
      message: "One or more Cart items are out of stock",
      reason: "outOfStock",
    });
  }
  if (
    hasCommercetoolsErrorCode(cause, "PriceChanged", "MatchingPriceNotFound")
  ) {
    return new OrderPlacementRejected({
      message: "One or more Cart prices changed",
      reason: "priceChanged",
    });
  }
  if (
    hasCommercetoolsErrorCode(
      cause,
      "ShippingMethodDoesNotMatchCart",
      "InvalidItemShippingDetails",
      "MissingTaxRateForCountry"
    )
  ) {
    return new OrderPlacementRejected({
      message: "The saved Shipping Options are no longer valid",
      reason: "shippingInvalid",
    });
  }
  return undefined;
};

const recoverOrderCreation = (
  apiRoot: ByProjectKeyRequestBuilder,
  input: PlaceOrderInput,
  failure: OrderProviderFailure
) =>
  Effect.gen(function* () {
    const recovered = yield* findOrder(apiRoot, input).pipe(
      Effect.catchTag(
        "OrderProviderFailure",
        (
          recoveryFailure
        ): Effect.Effect<
          never,
          OrderPlacementOutcomeUnknown | OrderProviderFailure
        > =>
          recoveryFailure.reason === "unavailable"
            ? Effect.fail(
                new OrderPlacementOutcomeUnknown({
                  cartId: input.cartId,
                  message: "Order creation outcome could not be recovered",
                  number: orderNumberForCart(input.cartId),
                })
              )
            : Effect.fail(recoveryFailure)
      )
    );
    if (Option.isSome(recovered)) {
      return recovered.value;
    }
    const rejection = rejectionFor(failure.cause);
    if (rejection !== undefined) {
      return yield* rejection;
    }
    if (failure.reason !== "unavailable") {
      return yield* failure;
    }
    return yield* new OrderPlacementOutcomeUnknown({
      cartId: input.cartId,
      message: "Order creation may have succeeded and must be recovered",
      number: orderNumberForCart(input.cartId),
    });
  });

const readOrderableCart = (
  apiRoot: ByProjectKeyRequestBuilder,
  input: PlaceOrderInput
) =>
  providerRequest("cart.readForOrder", async () => {
    const response = await apiRoot
      .carts()
      .withId({ ID: input.cartId })
      .get()
      .execute();
    return response.body;
  }).pipe(Effect.flatMap((cart) => requireOrderableCart(cart, input)));

export const ordersLayerFrom = (apiRoot: ByProjectKeyRequestBuilder) =>
  Layer.succeed(
    Orders,
    Orders.of({
      validateCart: Effect.fn("CommercetoolsOrders.validateCart")((input) =>
        readOrderableCart(apiRoot, input).pipe(Effect.asVoid)
      ),
      find: Effect.fn("CommercetoolsOrders.find")((input) =>
        findOrder(apiRoot, input)
      ),
      findById: Effect.fn("CommercetoolsOrders.findById")((input) =>
        findOrderById(apiRoot, input)
      ),
      place: Effect.fn("CommercetoolsOrders.place")(function* (input) {
        return yield* readOrderableCart(apiRoot, input).pipe(
          Effect.flatMap((cart) => {
            const body: OrderFromCartDraft = {
              cart: { id: cart.id, typeId: "cart" },
              orderNumber: orderNumberForCart(input.cartId),
              version: cart.version,
            };
            return providerRequest("order.create", async () => {
              const response = await apiRoot.orders().post({ body }).execute();
              return response.body;
            }).pipe(
              Effect.flatMap((order) => orderSnapshot(order, input.cartId)),
              Effect.catchTag("OrderProviderFailure", (error) =>
                recoverOrderCreation(apiRoot, input, error)
              )
            );
          })
        );
      }),
    })
  );

export const ordersLayer = Layer.unwrap(
  CommercetoolsRestClient.pipe(
    Effect.map(({ apiRoot }) => ordersLayerFrom(apiRoot))
  )
);
