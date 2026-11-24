import { timingSafeEqual } from "node:crypto";

import type { OrderWorkflowSignal } from "@repo/commerce-core/domain/order-lifecycle";
import { Schema } from "effect";

import {
  orderChangeMessages,
  orderCreatedMessage,
  paymentChangeMessages,
} from "./subscription";

/** The trusted subscription relay forwards native Message deliveries unchanged. */
const Event = Schema.Struct({
  notificationType: Schema.Literal("Message"),
  payloadNotIncluded: Schema.optional(
    Schema.Struct({ payloadType: Schema.NonEmptyString })
  ),
  projectKey: Schema.NonEmptyString,
  resource: Schema.Struct({
    id: Schema.NonEmptyString,
    typeId: Schema.Literals(["order", "payment"]),
  }),
  type: Schema.optional(Schema.NonEmptyString),
});
const Probe = Schema.Struct({
  notificationType: Schema.Literal("ResourceCreated"),
  projectKey: Schema.NonEmptyString,
  resource: Schema.Struct({ typeId: Schema.Literal("subscription") }),
});
/** Native payload validation is shared by authenticated event-source adapters. */
export const orderEventFromMessage = (
  payload: Schema.Json,
  projectKey: string
) => {
  const probe = Schema.decodeUnknownOption(Probe)(payload);
  if (probe._tag === "Some") {
    return {
      status:
        probe.value.projectKey === projectKey ? (204 as const) : (403 as const),
    };
  }
  const decoded = Schema.decodeUnknownOption(Event)(payload);
  if (decoded._tag === "None") {
    return { status: 400 as const };
  }
  if (decoded.value.projectKey !== projectKey) {
    return { status: 403 as const };
  }
  const messageType =
    decoded.value.type ?? decoded.value.payloadNotIncluded?.payloadType;
  if (!messageType) {
    return { status: 400 as const };
  }
  if (decoded.value.resource.typeId === "payment") {
    return paymentChangeMessages.includes(messageType)
      ? { paymentId: decoded.value.resource.id, status: 202 as const }
      : { status: 204 as const };
  }
  const orderId = decoded.value.resource.id;
  if (messageType === orderCreatedMessage) {
    return { orderId, status: 202 as const, trigger: "created" as const };
  }
  if (orderChangeMessages.includes(messageType)) {
    let trigger: OrderWorkflowSignal = "fulfillment";
    if (
      messageType === "OrderPaymentStateChanged" ||
      messageType === "OrderPaymentAdded"
    ) {
      trigger = "payment";
    } else if (messageType === "OrderStateChanged") {
      trigger = "cancellation";
    } else if (messageType === "OrderEditApplied") {
      trigger = "orderChanged";
    }
    return { orderId, status: 202 as const, trigger };
  }
  return { status: 204 as const };
};

export const decodeCommercetoolsOrderEvent = (
  headers: Headers,
  body: string,
  options: { readonly secret: string; readonly projectKey: string }
) => {
  const expected = Buffer.from(`Bearer ${options.secret}`);
  const actual = Buffer.from(headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401 as const };
  }
  const decoded = Schema.decodeOption(Schema.fromJsonString(Schema.Json))(body);
  if (decoded._tag === "None") {
    return { status: 400 as const };
  }
  return orderEventFromMessage(decoded.value, options.projectKey);
};
