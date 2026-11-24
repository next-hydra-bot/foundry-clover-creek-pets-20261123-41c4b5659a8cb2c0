import { createHmac } from "node:crypto";

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventConsumerFailure, handleCommercetoolsWebhook } from "./receiver";
import type { CommerceEventConsumer } from "./receiver";
import { combineSubscriptions } from "./subscriptions";

const secret = "test-event-secret";
const product = {
  data: {
    notificationType: "ResourceUpdated",
    projectKey: "project",
    resource: { id: "product-1", typeId: "product" },
  },
  notificationType: "ResourceUpdated",
  projectKey: "project",
  resourceId: "product-1",
  resourceTypeId: "product",
  timestamp: new Date().toISOString(),
};
const request = (payload = product, signingSecret = secret) => {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  return new Request("https://api.example.com/webhooks/commercetools", {
    body,
    headers: {
      "x-webhook-signature": `sha256=${createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex")}`,
      "x-webhook-source": "commercetools-event-proxy",
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
};
const environment = () => {
  vi.stubEnv("COMMERCETOOLS_PROJECT_KEY", "project");
  vi.stubEnv("COMMERCETOOLS_WEBHOOK_SECRET", secret);
};
describe("commerce webhook receiver", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("dispatches to every subscribed consumer and ignores unrelated consumers", async () => {
    environment();
    const deliveries: string[] = [];
    const consumer = (
      id: string,
      resourceTypeId: string
    ): CommerceEventConsumer => ({
      handle: () =>
        Effect.sync(() => {
          deliveries.push(id);
        }),
      subscription: { changes: [{ resourceTypeId }], messages: [] },
    });
    const result = await handleCommercetoolsWebhook(request(), [
      consumer("catalog", "product"),
      consumer("sync", "product"),
      consumer("orders", "order"),
    ]);
    expect(result.status).toBe(202);
    expect(deliveries).toEqual(["catalog", "sync"]);
  });

  it("rejects invalid signatures and contradictory envelopes before dispatch", async () => {
    environment();
    const handle = vi.fn<CommerceEventConsumer["handle"]>(() => Effect.void);
    const consumer = {
      handle,
      subscription: { changes: [{ resourceTypeId: "product" }], messages: [] },
    };
    const unsigned = await handleCommercetoolsWebhook(
      request(product, "wrong"),
      [consumer]
    );
    expect(unsigned.status).toBe(401);
    const contradictory = await handleCommercetoolsWebhook(
      request({ ...product, resourceId: "another" }),
      [consumer]
    );
    expect(contradictory.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns a retryable response when an installed consumer cannot process delivery", async () => {
    environment();
    const result = await handleCommercetoolsWebhook(request(), [
      {
        handle: () =>
          Effect.fail(
            new EventConsumerFailure({
              consumer: "catalog",
              message: "Test delivery failure",
              operation: "catalog.revalidation.send",
              reason: "transport",
              status: 503,
            })
          ),
        subscription: {
          changes: [{ resourceTypeId: "product" }],
          messages: [],
        },
      },
    ]);
    expect(result.status).toBe(503);
  });

  it("unions native subscription resources and message types deterministically", () => {
    expect(
      combineSubscriptions([
        {
          changes: [{ resourceTypeId: "product" }],
          messages: [{ resourceTypeId: "order", types: ["OrderCreated"] }],
        },
        {
          changes: [
            { resourceTypeId: "category" },
            { resourceTypeId: "product" },
          ],
          messages: [
            {
              resourceTypeId: "order",
              types: ["OrderCreated", "OrderStateChanged"],
            },
          ],
        },
      ])
    ).toEqual({
      changes: [{ resourceTypeId: "category" }, { resourceTypeId: "product" }],
      messages: [
        {
          resourceTypeId: "order",
          types: ["OrderCreated", "OrderStateChanged"],
        },
      ],
    });
  });
});
