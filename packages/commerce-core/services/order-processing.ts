import { Context } from "effect";
import type { Effect } from "effect";

import type { OrderId } from "../domain/order-identity";
import type {
  OrderLifecycleFailure,
  OrderLifecycleState,
  OrderNotice,
} from "../domain/order-lifecycle";

/** Privileged background operations. Never exposed as a shopper-facing query service. */
export class OrderProcessing extends Context.Service<
  OrderProcessing,
  {
    readonly read: (
      id: OrderId
    ) => Effect.Effect<OrderLifecycleState, OrderLifecycleFailure>;
    readonly notice: (
      id: OrderId
    ) => Effect.Effect<OrderNotice, OrderLifecycleFailure>;
    readonly reconcilePayment: (
      id: OrderId
    ) => Effect.Effect<OrderLifecycleState, OrderLifecycleFailure>;
    readonly close: (
      id: OrderId
    ) => Effect.Effect<OrderLifecycleState, OrderLifecycleFailure>;
  }
>()("@repo/commerce-core/OrderProcessing") {}

export class OrderEmails extends Context.Service<
  OrderEmails,
  {
    readonly send: (
      kind: "created" | "shipped",
      notice: OrderNotice,
      idempotencyKey: string
    ) => Effect.Effect<"sent" | "skipped", OrderLifecycleFailure>;
  }
>()("@repo/commerce-core/OrderEmails") {}
