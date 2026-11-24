import { Effect, Schema } from "effect";

import { commercetoolsRestClientLayer } from "../client/layers";
import { EventConsumerFailure } from "../webhooks/receiver";
import type { CommerceEventConsumer } from "../webhooks/receiver";
import { orderEventFromMessage } from "./event";
import { dispatchNativeOrderEvent } from "./native-event-dispatch";
import { orderSubscription } from "./subscription";

export const orderEventConsumer: CommerceEventConsumer = {
  handle: (event) =>
    Effect.gen(function* () {
      const native = orderEventFromMessage(event.data, event.projectKey);
      if (native.status === 400 || native.status === 403) {
        return yield* new EventConsumerFailure({
          consumer: "orders",
          message: "Invalid native Order or Payment event",
          operation: "orders.event.decode",
          reason: "invalidEvent",
          status: 400,
        });
      }
      if (native.status === 202) {
        yield* dispatchNativeOrderEvent(native);
      }
    }).pipe(
      Effect.provide(commercetoolsRestClientLayer),
      Effect.mapError((error) =>
        Schema.is(EventConsumerFailure)(error)
          ? error
          : new EventConsumerFailure({
              consumer: "orders",
              message:
                error === "waitingForStart"
                  ? "Order workflow hook is not ready; retry the update"
                  : "Order workflow dispatch failed",
              operation: "orders.workflow.dispatch",
              reason: "transport",
              status: 503,
            })
      )
    ),
  subscription: orderSubscription,
};
