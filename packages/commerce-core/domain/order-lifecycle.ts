import { Schema } from "effect";

import { CommerceLocale, StoreKey } from "../store";
import { CustomerDetails } from "./customer";
import { OrderLineItem, OrderMoney, OrderFulfillment } from "./order-history";
import { OrderId, OrderNumber } from "./order-identity";

/** Recorded purchase data for background notifications, without a shopper session. */
export const OrderNotice = Schema.Struct({
  detailUrl: Schema.optional(
    Schema.Redacted(Schema.NonEmptyString, { label: "orderAccessUrl" })
  ),
  fulfillments: Schema.Array(OrderFulfillment),
  id: OrderId,
  lineItems: Schema.Array(OrderLineItem),
  locale: CommerceLocale,
  number: Schema.optional(OrderNumber),
  purchasingMode: Schema.Literals(["b2c", "b2b"]),
  recipient: Schema.optional(CustomerDetails.fields.email),
  storeKey: Schema.optional(StoreKey),
  total: OrderMoney,
});
export type OrderNotice = typeof OrderNotice.Type;

export const OrderLifecycleState = Schema.Struct({
  cancelled: Schema.Boolean,
  closed: Schema.Boolean,
  createdAt: Schema.NonEmptyString,
  deferredPayment: Schema.Boolean,
  fullyShipped: Schema.Boolean,
  managed: Schema.Boolean,
  paymentSettled: Schema.Boolean,
});
export type OrderLifecycleState = typeof OrderLifecycleState.Type;

export type OrderWorkflowSignal =
  | "fulfillment"
  | "payment"
  | "cancellation"
  | "orderChanged";

export const orderWorkflowAdmissionWindow = 7 * 24 * 60 * 60 * 1000;

export const orderWorkflowToken = (orderId: string) =>
  `order-fulfillment:${orderId}`;

export const orderPaymentToken = (orderId: string) =>
  `order-payment:${orderId}`;

export const orderWorkflowAccepts = (
  order: OrderLifecycleState,
  now: number
): boolean =>
  order.managed &&
  now - Date.parse(order.createdAt) < orderWorkflowAdmissionWindow;

export class OrderLifecycleFailure extends Schema.TaggedError<OrderLifecycleFailure>()(
  "OrderLifecycleFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    operation: Schema.optional(Schema.NonEmptyString),
    orderId: OrderId,
    reason: Schema.Literals([
      "unavailable",
      "configuration",
      "invalidData",
      "conflict",
    ]),
  }
) {}
