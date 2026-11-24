import "server-only";
import { layerResendEmailProvider } from "@repo/email/resend-provider";
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Schema,
} from "effect";
import { FatalError, RetryableError } from "workflow";

import { EmailOrderAccess } from "../domain/order-access";
import { OrderId } from "../domain/order-identity";
import { OrderLifecycleFailure, OrderNotice } from "../domain/order-lifecycle";
import { orderAccessLinksLayer } from "../lib/orders/access-links";
import { OrderAccessLinks } from "../services/order-access-links";
import { OrderEmails, OrderProcessing } from "../services/order-processing";
import { orderEmailsLayer } from "./emails";

const NoticeJson = Schema.toCodecJson(OrderNotice);
const emailRetryWindow = 23 * 60 * 60 * 1000;

export interface PreparedOrderEmail {
  readonly notice: typeof NoticeJson.Encoded;
  readonly preparedAt: number;
}

async function runStep<A, E, R, LE>(
  runtime: ManagedRuntime.ManagedRuntime<R, LE>,
  operation: Effect.Effect<A, E, R>
): Promise<A> {
  const exit = await runtime.runPromiseExit(operation);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const error = Cause.squash(exit.cause);
  if (Schema.is(OrderLifecycleFailure)(error)) {
    if (error.reason === "unavailable" || error.reason === "conflict") {
      throw new RetryableError(error.message, { retryAfter: "30s" });
    }
    throw new FatalError(error.message);
  }
  if (Schema.isSchemaError(error)) {
    throw new FatalError("Invalid order workflow data");
  }
  throw new FatalError(
    "Order workflow runtime could not execute the step; inspect configuration"
  );
}

const orderOperation = <A, E>(
  id: string,
  operation: (
    orders: OrderProcessing["Service"],
    orderId: OrderId
  ) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    const orders = yield* OrderProcessing;
    return yield* operation(orders, OrderId.make(id));
  });

export const orderWorkflowSteps = <E>(
  layer: Layer.Layer<OrderProcessing, E>
) => {
  const processing = ManagedRuntime.make(layer);
  const emails = ManagedRuntime.make(
    orderEmailsLayer.pipe(Layer.provide(layerResendEmailProvider))
  );

  return {
    closeOrder: async (id: string) =>
      await runStep(
        processing,
        orderOperation(id, (orders, orderId) => orders.close(orderId))
      ),
    prepareEmail: async (id: string): Promise<PreparedOrderEmail | null> =>
      await runStep(
        processing,
        Effect.gen(function* () {
          let notice = yield* orderOperation(id, (orders, orderId) =>
            orders.notice(orderId)
          );
          const { recipient, storeKey } = notice;
          if (!recipient) {
            return null;
          }
          if (notice.purchasingMode === "b2c" && storeKey) {
            const detailUrl = yield* Effect.gen(function* () {
              const links = yield* OrderAccessLinks;
              return yield* links.issue(
                new EmailOrderAccess({
                  orderId: notice.id,
                  recipient,
                  storeKey,
                }),
                notice.locale
              );
            }).pipe(
              Effect.provide(orderAccessLinksLayer),
              Effect.mapError(
                (error) =>
                  new OrderLifecycleFailure({
                    cause: error,
                    message: "Order email access link could not be prepared",
                    orderId: notice.id,
                    reason:
                      error.reason === "configuration"
                        ? "configuration"
                        : "unavailable",
                  })
              )
            );
            notice = { ...notice, detailUrl };
          }
          return {
            notice: yield* Schema.encodeEffect(NoticeJson)(notice),
            preparedAt: yield* Clock.currentTimeMillis,
          };
        })
      ),
    readOrder: async (id: string) =>
      await runStep(
        processing,
        orderOperation(id, (orders, orderId) => orders.read(orderId))
      ),
    sendEmail: async (
      kind: "created" | "shipped",
      email: PreparedOrderEmail
    ) => {
      const now = await Effect.runPromise(Clock.currentTimeMillis);
      if (now - email.preparedAt >= emailRetryWindow) {
        throw new FatalError(
          "Reconcile the order email before retrying outside the delivery deduplication window"
        );
      }
      await runStep(
        emails,
        Effect.gen(function* () {
          const notice = yield* Schema.decodeEffect(NoticeJson)(email.notice);
          const sender = yield* OrderEmails;
          yield* sender.send(
            kind,
            notice,
            `order-${kind}:${encodeURIComponent(notice.id)}`
          );
        })
      );
    },
    settleImmediatePayment: async (id: string) =>
      await runStep(
        processing,
        orderOperation(id, (orders, orderId) =>
          orders.reconcilePayment(orderId)
        )
      ),
  };
};
