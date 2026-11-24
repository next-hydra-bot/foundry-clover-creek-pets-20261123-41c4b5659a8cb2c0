import type { CartId } from "@repo/commerce-core/domain/cart";
import type {
  OrderId,
  OrderRecord,
  OrderSnapshot,
} from "@repo/commerce-core/domain/order";
import { toOrderSnapshot } from "@repo/commerce-core/domain/order";
import { toCheckoutScope } from "@repo/commerce-core/lib/checkout/request-context";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Orders } from "@repo/commerce-core/services/orders";
import { CheckoutPayments } from "@repo/payments";
import { Effect, Option } from "effect";

export interface OrderConfirmationSnapshot {
  readonly order: OrderSnapshot;
  readonly paymentStatus: "confirmed" | "pending";
}

export interface FindOrderConfirmationInput {
  readonly anonymousAccess?: {
    readonly cartId: CartId;
    readonly orderId: OrderId;
  };
  readonly orderId: OrderId;
}

const paymentStatusFor = Effect.fn("OrderConfirmation.paymentStatusFor")(
  (order: OrderRecord) =>
    CheckoutPayments.getFinalizationStatus(order.paymentReference).pipe(
      Effect.catchTag("PaymentProviderFailure", (error) => {
        const logFailure = Effect.logError(
          "Order exists but Payment status could not be read",
          error
        ).pipe(Effect.annotateLogs({ "order.id": order.id }));
        return error.reason === "unavailable" ||
          error.reason === "outcomeUnknown"
          ? logFailure.pipe(Effect.as("pending" as const))
          : logFailure.pipe(Effect.andThen(Effect.die(error)));
      })
    )
);

const confirmationFor = Effect.fn("OrderConfirmation.confirmationFor")(
  (order: OrderRecord) =>
    Effect.all({
      paymentMethod: CheckoutPayments.getPaymentMethod(order.paymentReference),
      paymentStatus: paymentStatusFor(order),
    }).pipe(
      Effect.map(
        ({ paymentMethod, paymentStatus }): OrderConfirmationSnapshot => ({
          order: toOrderSnapshot(order, paymentMethod),
          paymentStatus,
        })
      )
    )
);

export const findOrderConfirmation = Effect.fn("OrderConfirmation.findById")(
  function* (input: FindOrderConfirmationInput) {
    const commerceContext = yield* CommerceContext;
    const orders = yield* Orders;
    const scope = toCheckoutScope(commerceContext);
    const found = yield* orders.findById(
      input.anonymousAccess === undefined
        ? { id: input.orderId, scope }
        : {
            anonymousAccess: input.anonymousAccess,
            id: input.orderId,
            scope,
          }
    );
    return yield* Option.match(found, {
      onNone: () => Effect.succeed(Option.none<OrderConfirmationSnapshot>()),
      onSome: (order) => confirmationFor(order).pipe(Effect.map(Option.some)),
    });
  }
);

export const recoverOrderConfirmation = Effect.fn("OrderConfirmation.recover")(
  function* (cartId: CartId) {
    const commerceContext = yield* CommerceContext;
    const orders = yield* Orders;
    const found = yield* orders.find({
      cartId,
      scope: toCheckoutScope(commerceContext),
    });
    return yield* Option.match(found, {
      onNone: () => Effect.succeed(Option.none<OrderConfirmationSnapshot>()),
      onSome: (order) => confirmationFor(order).pipe(Effect.map(Option.some)),
    });
  }
);
