import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CommercetoolsRestClient } from "../client/rest-client";
import { dispatchNativeOrderEvent } from "./native-event-dispatch";

describe("native Payment event routing", () => {
  it("pages through linked Orders with the real SDK and wakes each one", async () => {
    const requests: URL[] = [];
    const orders: { id: string; trigger: string }[] = [];
    const root = createApiBuilderFromCtpClient({
      execute: async (request: { readonly uri: string }) => {
        const url = new URL(request.uri, "https://api.example.test");
        requests.push(url);
        return await Promise.resolve({
          body: {
            results:
              requests.length === 1
                ? Array.from({ length: 100 }, (_, i) => ({
                    id: `order-${String(i).padStart(3, "0")}`,
                  }))
                : [{ id: "order-100" }],
          },
          statusCode: 200,
        });
      },
    }).withProjectKey({ projectKey: "project" });
    await Effect.runPromise(
      dispatchNativeOrderEvent(
        { paymentId: "payment-1", status: 202 },
        async (id, trigger) => {
          orders.push({ id, trigger });
          await Promise.resolve();
        }
      ).pipe(Effect.provide(CommercetoolsRestClient.testLayer(root)))
    );
    expect(orders).toEqual(
      Array.from({ length: 101 }, (_, i) => ({
        id: `order-${String(i).padStart(3, "0")}`,
        trigger: "payment",
      }))
    );
    expect(requests[0]?.searchParams.getAll("where")).toEqual([
      'paymentInfo(payments(id="payment-1"))',
    ]);
    expect(requests[1]?.searchParams.getAll("where")).toContain(
      'id>"order-099"'
    );
  });

  it("propagates a wakeup failure for native delivery retries", async () => {
    const root = createApiBuilderFromCtpClient({
      execute: () => {
        throw new Error("Unexpected provider read");
      },
    }).withProjectKey({ projectKey: "project" });
    await expect(
      Effect.runPromise(
        dispatchNativeOrderEvent(
          { orderId: "order-1", status: 202, trigger: "payment" },
          async () => {
            await Promise.resolve();
            throw new Error("SDK unavailable");
          }
        ).pipe(Effect.provide(CommercetoolsRestClient.testLayer(root)))
      )
    ).rejects.toBe("unavailable");
  });

  it("requests redelivery for an update that is waiting for creation", async () => {
    const result = await Effect.runPromise(
      Effect.flip(
        dispatchNativeOrderEvent(
          { orderId: "order-1", status: 202, trigger: "payment" },
          async () => await Promise.resolve("waitingForStart" as const)
        ).pipe(
          Effect.provide(
            CommercetoolsRestClient.testLayer(
              createApiBuilderFromCtpClient({
                execute: () => {
                  throw new Error("Unexpected provider read");
                },
              }).withProjectKey({ projectKey: "project" })
            )
          )
        )
      )
    );
    expect(result).toBe("waitingForStart");
  });
});
