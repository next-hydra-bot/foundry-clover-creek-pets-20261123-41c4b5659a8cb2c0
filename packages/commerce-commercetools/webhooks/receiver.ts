import { Clock, Config, Effect, Redacted, Schema } from "effect";

import { decodeCommercetoolsWebhookEvent } from "./event";
import type { CommercetoolsWebhookEvent } from "./event";
import type { EventSubscription } from "./subscriptions";

export class EventConsumerFailure extends Schema.TaggedError<EventConsumerFailure>()(
  "EventConsumerFailure",
  {
    consumer: Schema.String,
    message: Schema.String,
    operation: Schema.String,
    reason: Schema.Literals([
      "configuration",
      "transport",
      "http",
      "timeout",
      "invalidEvent",
    ]),
    status: Schema.Literals([400, 503]),
    downstreamStatus: Schema.optional(Schema.Int),
  }
) {}

export interface CommerceEventConsumer {
  readonly subscription: EventSubscription;
  readonly handle: (
    event: CommercetoolsWebhookEvent
  ) => Effect.Effect<void, EventConsumerFailure>;
}

const accepts = (
  consumer: CommerceEventConsumer,
  event: CommercetoolsWebhookEvent
) =>
  event.notificationType === "Message"
    ? consumer.subscription.messages.some(
        (entry) =>
          entry.resourceTypeId === event.resourceTypeId &&
          (entry.types.length === 0 ||
            (event.messageType !== undefined &&
              entry.types.includes(event.messageType)))
      )
    : ["ResourceCreated", "ResourceUpdated", "ResourceDeleted"].includes(
        event.notificationType
      ) &&
      consumer.subscription.changes.some(
        (entry) => entry.resourceTypeId === event.resourceTypeId
      );

/** Verify the raw delivery once; processing failures remain retryable at the transport boundary. */
export const handleCommercetoolsWebhook = async (
  request: Request,
  consumers: readonly CommerceEventConsumer[]
): Promise<Response> => {
  const status = await Effect.runPromise(
    Effect.gen(function* () {
      const projectKey = yield* Config.NonEmptyString(
        "COMMERCETOOLS_PROJECT_KEY"
      );
      const secret = yield* Config.schema(
        Schema.RedactedFromValue(Schema.NonEmptyString),
        "COMMERCETOOLS_WEBHOOK_SECRET"
      );
      const now = yield* Clock.currentTimeMillis;
      const body = yield* Effect.tryPromise(async () => await request.text());
      const decoded = decodeCommercetoolsWebhookEvent(request.headers, body, {
        now,
        projectKey,
        secret: Redacted.value(secret),
      });
      if (!("event" in decoded) || decoded.event === undefined) {
        return decoded.status;
      }
      for (const consumer of consumers.filter((consumer) =>
        accepts(consumer, decoded.event)
      )) {
        yield* consumer.handle(decoded.event);
      }
      return 202;
    }).pipe(
      Effect.catchTag("EventConsumerFailure", (error) =>
        Effect.logError("Commerce event consumer failed").pipe(
          Effect.annotateLogs({
            consumer: error.consumer,
            message: error.message,
            operation: error.operation,
            reason: error.reason,
            status: error.status,
            downstreamStatus: error.downstreamStatus,
          }),
          Effect.as(error.status)
        )
      ),
      Effect.catch(() =>
        Effect.logError("Commerce webhook receiver unavailable").pipe(
          Effect.annotateLogs({
            operation: "webhook.receive",
            reason: "configuration-or-body-read",
          }),
          Effect.as(503)
        )
      )
    )
  );
  return new Response(null, { status });
};
