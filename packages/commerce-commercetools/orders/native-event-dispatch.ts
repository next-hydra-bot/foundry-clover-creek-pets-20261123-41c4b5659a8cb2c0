import type { OrderWorkflowSignal } from "@repo/commerce-core/domain/order-lifecycle";
import { Effect, Schema } from "effect";

import { CommercetoolsRestClient } from "../client/rest-client";
import type { orderEventFromMessage } from "./event";
import { dispatchOrderEvent } from "./workflow-dispatch";

const quotePredicateValue = Schema.encodeSync(
  Schema.fromJsonString(Schema.String)
);

/** A Payment is a separate resource; wake every Order that references it. */
export const dispatchNativeOrderEvent = (
  event: Extract<ReturnType<typeof orderEventFromMessage>, { status: 202 }>,
  dispatch = dispatchOrderEvent
) =>
  Effect.gen(function* () {
    const dispatchOrder = (
      id: string,
      trigger: "created" | OrderWorkflowSignal
    ) =>
      Effect.tryPromise({
        catch: () => "unavailable" as const,
        try: async () => await dispatch(id, trigger),
      });

    if ("orderId" in event && event.orderId !== undefined) {
      const result = yield* dispatchOrder(event.orderId, event.trigger);
      if (result === "waitingForStart") {
        return yield* Effect.fail(result);
      }
      return;
    }
    const { apiRoot } = yield* CommercetoolsRestClient;
    let after: string | undefined;
    let waitingForStart = false;
    for (;;) {
      const cursor = after;
      const response = yield* Effect.tryPromise({
        catch: () => "unavailable" as const,
        try: async () =>
          await apiRoot
            .orders()
            .get({
              queryArgs: {
                limit: 100,
                sort: ["id asc"],
                where: [
                  `paymentInfo(payments(id=${quotePredicateValue(event.paymentId)}))`,
                  ...(cursor ? [`id>${quotePredicateValue(cursor)}`] : []),
                ],
                withTotal: false,
              },
            })
            .execute(),
      });
      for (const order of response.body.results) {
        const result = yield* dispatchOrder(order.id, "payment");
        if (result === "waitingForStart") {
          waitingForStart = true;
        }
      }
      if (response.body.results.length < 100) {
        break;
      }
      const last = response.body.results.at(-1)?.id;
      if (!last || (after && last <= after)) {
        return yield* Effect.fail("unavailable" as const);
      }
      after = last;
    }
    if (waitingForStart) {
      return yield* Effect.fail("waitingForStart" as const);
    }
  });
