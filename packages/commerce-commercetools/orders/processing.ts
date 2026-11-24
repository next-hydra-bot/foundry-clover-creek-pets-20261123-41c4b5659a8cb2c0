import type {
  ByProjectKeyRequestBuilder,
  Order,
  Payment,
  TaxRate,
} from "@commercetools/platform-sdk";
import type { OrderId } from "@repo/commerce-core/domain/order-identity";
import {
  OrderLifecycleFailure,
  OrderLifecycleState,
  OrderNotice,
} from "@repo/commerce-core/domain/order-lifecycle";
import { OrderProcessing } from "@repo/commerce-core/services/order-processing";
import { CommerceLocale, storeConfiguration } from "@repo/commerce-core/store";
import { defaultLocale } from "@repo/i18n/config";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import { payableTotal } from "../cart/price";
import { CommercetoolsRestClient } from "../client/rest-client";
import { isConcurrentModification } from "../client/versioned-write";
import { cardPaymentKeyForCheckout } from "../payment-repository/keys";
import { variantReference } from "../product/variant-reference";
import { orderMoney as money } from "./amounts";

const taxIncluded = (rate: TaxRate | undefined) => {
  if (!rate) {
    return "unknown";
  }
  return rate.includedInPrice ? "yes" : "no";
};
const failure = (orderId: OrderId, cause?: unknown) =>
  new OrderLifecycleFailure({
    cause,
    message: "Order processing is unavailable",
    orderId,
    reason: "unavailable",
  });
export const orderNotice = (order: Order) => {
  const store = storeConfiguration.find(
    (item) => item.storeKey === order.store?.key
  );
  const locale = Option.getOrElse(
    Schema.decodeUnknownOption(CommerceLocale)(order.locale),
    () => store?.locale ?? CommerceLocale.make(defaultLocale)
  );
  const name = (value: Record<string, string>) =>
    value[locale] ?? value[defaultLocale] ?? Object.values(value)[0];
  return Schema.decodeUnknownSync(OrderNotice)({
    fulfillments: [
      ...(order.shippingInfo?.deliveries ?? []),
      ...(order.shipping ?? []).flatMap(
        (item) => item.shippingInfo.deliveries ?? []
      ),
    ].map((item) => ({
      deliveryStatus: "unknown",
      id: item.id,
      lineItems: item.items.map((line) => ({
        lineItemId: line.id,
        quantity: line.quantity,
      })),
      status: "unknown",
      tracking: item.parcels.flatMap((parcel) =>
        parcel.trackingData
          ? [
              {
                carrier: parcel.trackingData.carrier,
                number: parcel.trackingData.trackingId,
              },
            ]
          : []
      ),
    })),
    id: order.id,
    lineItems: [
      ...order.lineItems.map((line) => ({
        id: line.id,
        name: name(line.name),
        orderedQuantity: line.quantity,
        productId: line.productId,
        sku: line.variant.sku,
        total: {
          money: money(line.totalPrice),
          taxIncluded: taxIncluded(line.taxRate),
        },
        variantId: variantReference(line.productId, line.variant.id),
      })),
      ...order.customLineItems.map((line) => ({
        id: line.id,
        name: name(line.name),
        orderedQuantity: line.quantity,
        total: {
          money: money(line.totalPrice),
          taxIncluded: taxIncluded(line.taxRate),
        },
      })),
    ],
    locale,
    number: order.orderNumber,
    purchasingMode: order.businessUnit === undefined ? "b2c" : "b2b",
    recipient:
      order.customerEmail === undefined
        ? undefined
        : Redacted.make(order.customerEmail, { label: "email" }),
    storeKey: order.store?.key,
    total: money(payableTotal(order)),
  });
};

const stateFrom = (order: Order) =>
  OrderLifecycleState.make({
    cancelled: order.orderState === "Cancelled",
    closed: order.orderState === "Complete",
    createdAt: order.createdAt,
    deferredPayment: (order.paymentInfo?.payments ?? []).some(
      (payment) => payment.obj?.paymentMethodInfo.method === "netTerms"
    ),
    fullyShipped:
      order.shipmentState === "Shipped" || order.shipmentState === "Delivered",
    managed: storeConfiguration.some(
      (store) => store.storeKey === order.store?.key
    ),
    paymentSettled: order.paymentState === "Paid",
  });

const netCardFunds = (payments: readonly Payment[], currency: string) => {
  const movements = payments.flatMap((payment) =>
    payment.transactions.filter(
      (transaction) =>
        transaction.state === "Success" &&
        (transaction.type === "Charge" || transaction.type === "Refund")
    )
  );
  if (
    movements.length === 0 ||
    movements.some(
      (transaction) => transaction.amount.currencyCode !== currency
    )
  ) {
    return undefined;
  }
  return movements.reduce(
    (sum, transaction) =>
      sum +
      (transaction.type === "Refund" ? -1n : 1n) *
        BigInt(transaction.amount.centAmount),
    0n
  );
};

export const orderProcessingLayerFrom = (api: ByProjectKeyRequestBuilder) => {
  const readNative = (id: OrderId, expand?: string[]) =>
    Effect.tryPromise({
      catch: (cause) => failure(id, cause),
      try: async () => {
        const response = await api
          .orders()
          .withId({ ID: id })
          .get(expand ? { queryArgs: { expand } } : undefined)
          .execute();
        return response.body;
      },
    });
  const readForProcessing = Effect.fn("CommercetoolsOrderProcessing.readState")(
    function* (id: OrderId) {
      const order = yield* readNative(id, ["paymentInfo.payments[*]"]);
      const state = stateFrom(order);
      if (!state.managed || state.cancelled || state.closed) {
        return { canReconcile: false, order, state };
      }
      const paymentsById = new Map<string, Payment>();
      for (const reference of order.paymentInfo?.payments ?? []) {
        if (reference.obj?.id !== reference.id) {
          return yield* new OrderLifecycleFailure({
            message:
              "Order payment could not be expanded; verify view_payments access",
            operation: "order.payment.read",
            orderId: id,
            reason: "configuration",
          });
        }
        paymentsById.set(reference.id, reference.obj);
      }
      const payments = [...paymentsById.values()];
      const total = payableTotal(order);
      // Net Terms transactions represent a credit commitment.
      const cards = payments.filter(
        ({ paymentMethodInfo }) => paymentMethodInfo.method === "card"
      );
      const collected = netCardFunds(cards, total.currencyCode);
      const payable = BigInt(total.centAmount);
      const checkoutKey =
        order.cart && cardPaymentKeyForCheckout(order.cart.id);
      if (checkoutKey && cards.some(({ key }) => key === checkoutKey)) {
        const covered = collected !== undefined && collected >= payable;
        return {
          canReconcile: covered,
          order,
          state: { ...state, paymentSettled: state.paymentSettled && covered },
        };
      }
      const [payment] = cards;
      return {
        canReconcile:
          payments.length === 1 &&
          payment?.amountPlanned.currencyCode === total.currencyCode &&
          payment.amountPlanned.centAmount === total.centAmount &&
          collected === payable,
        order,
        state,
      };
    }
  );
  const reconcilePayment = Effect.fn(
    "CommercetoolsOrderProcessing.reconcilePayment"
  )(function* (id: OrderId) {
    const { canReconcile, order, state } = yield* readForProcessing(id);
    if (!canReconcile || state.paymentSettled || state.deferredPayment) {
      return state;
    }
    const updated = yield* Effect.tryPromise({
      catch: (cause) =>
        new OrderLifecycleFailure({
          cause,
          message: "Order payment state could not be reconciled",
          operation: "order.payment.reconcile",
          orderId: id,
          reason: isConcurrentModification(cause) ? "conflict" : "unavailable",
        }),
      try: async () => {
        const response = await api
          .orders()
          .withId({ ID: id })
          .post({
            body: {
              actions: [{ action: "changePaymentState", paymentState: "Paid" }],
              version: order.version,
            },
          })
          .execute();
        return response.body;
      },
    });
    if (updated.id !== id || updated.paymentState !== "Paid") {
      return yield* new OrderLifecycleFailure({
        message: "Order payment reconciliation returned an invalid order",
        operation: "order.payment.reconcile",
        orderId: id,
        reason: "invalidData",
      });
    }
    return { ...state, paymentSettled: true };
  });
  return Layer.succeed(OrderProcessing, {
    close: Effect.fn("CommercetoolsOrderProcessing.close")(function* (
      id: OrderId
    ) {
      const { order, state: current } = yield* readForProcessing(id);
      if (
        !current.managed ||
        current.cancelled ||
        current.closed ||
        !current.fullyShipped ||
        !current.paymentSettled
      ) {
        return current;
      }
      const updated = yield* Effect.tryPromise({
        catch: (cause) =>
          new OrderLifecycleFailure({
            cause,
            message: "Order could not be completed",
            operation: "order.close",
            orderId: id,
            reason: isConcurrentModification(cause)
              ? "conflict"
              : "unavailable",
          }),
        try: async () => {
          const response = await api
            .orders()
            .withId({ ID: id })
            .post({
              body: {
                actions: [
                  { action: "changeOrderState", orderState: "Complete" },
                ],
                version: order.version,
              },
            })
            .execute();
          return response.body;
        },
      });
      if (updated.id !== id || updated.orderState !== "Complete") {
        return yield* new OrderLifecycleFailure({
          message: "Order closure returned an invalid order",
          operation: "order.close",
          orderId: id,
          reason: "invalidData",
        });
      }
      return { ...current, closed: true };
    }),
    notice: Effect.fn("CommercetoolsOrderProcessing.notice")(function* (
      id: OrderId
    ) {
      const order = yield* readNative(id);
      return yield* Effect.try({
        catch: (cause) =>
          new OrderLifecycleFailure({
            cause,
            message: "Invalid order notification data",
            orderId: id,
            reason: "invalidData",
          }),
        try: () => orderNotice(order),
      });
    }),
    read: Effect.fn("CommercetoolsOrderProcessing.read")((id: OrderId) =>
      readForProcessing(id).pipe(Effect.map(({ state }) => state))
    ),
    reconcilePayment,
  });
};
export const orderProcessingLayer = Layer.unwrap(
  CommercetoolsRestClient.pipe(
    Effect.map(({ apiRoot }) => orderProcessingLayerFrom(apiRoot))
  )
);
