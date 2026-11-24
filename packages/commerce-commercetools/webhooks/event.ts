import { createHmac, timingSafeEqual } from "node:crypto";

import { Schema } from "effect";

const Envelope = Schema.Struct({
  data: Schema.Json,
  messageType: Schema.optional(Schema.NonEmptyString),
  notificationType: Schema.NonEmptyString,
  projectKey: Schema.NonEmptyString,
  resourceId: Schema.NonEmptyString,
  resourceTypeId: Schema.NonEmptyString,
  timestamp: Schema.String,
});

export type CommercetoolsWebhookEvent = typeof Envelope.Type;

/** Matches the Connect proxy's timestamped HMAC protocol, independently of event consumers. */
export const decodeCommercetoolsWebhookEvent = (
  headers: Headers,
  body: string,
  options: {
    readonly secret: string;
    readonly projectKey: string;
    readonly now: number;
  }
) => {
  const timestamp = headers.get("x-webhook-timestamp");
  const signature = headers.get("x-webhook-signature");
  if (
    !timestamp ||
    !signature ||
    headers.get("x-webhook-source") !== "commercetools-event-proxy"
  ) {
    return { status: 401 as const };
  }
  const sentAt = Number(timestamp);
  if (
    !/^[1-9]\d*$/u.test(timestamp) ||
    !Number.isSafeInteger(sentAt) ||
    Math.abs(options.now - sentAt) > 5 * 60 * 1000
  ) {
    return { status: 401 as const };
  }
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", options.secret).update(`${timestamp}.${body}`, "utf-8").digest("hex")}`
  );
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401 as const };
  }
  const decoded = Schema.decodeOption(Schema.fromJsonString(Envelope))(body);
  if (decoded._tag === "None") {
    return { status: 400 as const };
  }
  if (decoded.value.projectKey !== options.projectKey) {
    return { status: 403 as const };
  }
  const native = Schema.decodeUnknownOption(
    Schema.Struct({
      notificationType: Schema.NonEmptyString,
      payloadNotIncluded: Schema.optional(
        Schema.Struct({ payloadType: Schema.NonEmptyString })
      ),
      projectKey: Schema.NonEmptyString,
      resource: Schema.Struct({
        id: Schema.NonEmptyString,
        typeId: Schema.NonEmptyString,
      }),
      type: Schema.optional(Schema.NonEmptyString),
    })
  )(decoded.value.data);
  if (
    native._tag === "None" ||
    native.value.projectKey !== decoded.value.projectKey ||
    native.value.notificationType !== decoded.value.notificationType ||
    native.value.resource.id !== decoded.value.resourceId ||
    native.value.resource.typeId !== decoded.value.resourceTypeId
  ) {
    return { status: 400 as const };
  }
  const messageType =
    native.value.type ?? native.value.payloadNotIncluded?.payloadType;
  if (
    decoded.value.notificationType === "Message" &&
    (!messageType ||
      (decoded.value.messageType !== undefined &&
        decoded.value.messageType !== messageType))
  ) {
    return { status: 400 as const };
  }
  if (messageType) {
    return { event: { ...decoded.value, messageType }, status: 202 as const };
  }
  return { event: decoded.value, status: 202 as const };
};
