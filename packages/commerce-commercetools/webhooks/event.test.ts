import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeCommercetoolsWebhookEvent } from "./event";

const now = 1_793_534_400_000;
const options = {
  now,
  projectKey: "project",
  secret: "connect-signing-secret",
};
const payload = {
  data: {
    notificationType: "Message",
    projectKey: "project",
    resource: { id: "order-1", typeId: "order" },
    type: "OrderCreated",
  },
  messageType: "OrderCreated",
  notificationType: "Message",
  projectKey: "project",
  resourceId: "order-1",
  resourceTypeId: "order",
  timestamp: "2026-11-01T12:00:00Z",
};
const sign = (body: string, time = now) =>
  new Headers({
    "x-webhook-signature": `sha256=${createHmac("sha256", options.secret).update(`${time}.${body}`, "utf-8").digest("hex")}`,
    "x-webhook-source": "commercetools-event-proxy",
    "x-webhook-timestamp": String(time),
  });

describe("Connect proxy event protocol", () => {
  it("accepts the proxy's normalized envelope and exact timestamped HMAC", () => {
    const body = JSON.stringify(payload);
    expect(
      decodeCommercetoolsWebhookEvent(sign(body), body, options)
    ).toMatchObject({
      event: { data: payload.data, resourceId: "order-1" },
      status: 202,
    });
  });

  it("rejects tampering, stale signatures and the wrong project", () => {
    const body = JSON.stringify(payload);
    expect(
      decodeCommercetoolsWebhookEvent(sign(body), `${body} `, options)
    ).toEqual({
      status: 401,
    });
    expect(
      decodeCommercetoolsWebhookEvent(sign(body, now - 600_000), body, options)
    ).toEqual({ status: 401 });
    const other = JSON.stringify({ ...payload, projectKey: "other" });
    expect(
      decodeCommercetoolsWebhookEvent(sign(other), other, options)
    ).toEqual({
      status: 403,
    });
  });

  it("requires the expected proxy source and a well-formed envelope", () => {
    const body = JSON.stringify(payload);
    const headers = sign(body);
    headers.set("x-webhook-source", "other");
    expect(decodeCommercetoolsWebhookEvent(headers, body, options)).toEqual({
      status: 401,
    });
    expect(decodeCommercetoolsWebhookEvent(sign("{}"), "{}", options)).toEqual({
      status: 400,
    });
  });
});
