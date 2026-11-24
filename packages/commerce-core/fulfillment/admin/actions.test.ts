import { ConfigProvider, Effect } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { describe, expect, it } from "vitest";

import { fulfillmentConflict } from "../api";
import { fulfillmentCommandFromForm, submitFulfillmentEffect } from "./actions";

const form = () => {
  const value = new FormData();
  value.set("locale", "en-US");
  value.set("orderId", "opaque-order");
  value.set("revision", "native-revision");
  value.set("groupId", "default");
  value.set("deliveryId", "delivery-1");
  return value;
};
describe("fulfillment quantity form", () => {
  it("preserves opaque Order line IDs and submits only selected quantities", async () => {
    const value = form();
    value.append("quantity:gid://provider/Line/1", "2");
    value.append("quantity:other-line", "0");
    await expect(
      Effect.runPromise(fulfillmentCommandFromForm(value))
    ).resolves.toMatchObject({
      items: [{ lineItemId: "gid://provider/Line/1", quantity: 2 }],
      orderId: "opaque-order",
      revision: "native-revision",
    });
  });

  it.each(["-1", "1.5", "NaN", "9007199254740992"])(
    "rejects invalid quantities %s",
    async (quantity) => {
      const value = form();
      value.set("quantity:line", quantity);
      await expect(
        Effect.runPromise(fulfillmentCommandFromForm(value))
      ).rejects.toBeDefined();
    }
  );
});

const submission = (
  reply: (
    request: HttpClientRequest.HttpClientRequest
  ) => Effect.Effect<
    HttpClientResponse.HttpClientResponse,
    HttpClientError.HttpClientError
  >
) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const client = HttpClient.make((request) => {
    requests.push(request);
    return reply(request);
  });
  const run = async (operation: "pack" | "ship", value: FormData) =>
    await Effect.runPromise(
      submitFulfillmentEffect(operation, value, "test-admin-token").pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            FULFILLMENT_API_URL: "https://api.example.test/fulfillment",
          })
        )
      )
    );
  return { requests, run };
};
describe("fulfillment submission", () => {
  it("validates quantities before sending an HTTP request", async () => {
    const f = submission(() => Effect.die("Invalid input must not reach HTTP"));
    const value = form();
    value.set("quantity:line-1", "-1");
    await expect(f.run("pack", value)).resolves.toEqual({
      message: "Enter positive whole quantities for at least one item.",
      ok: false,
    });
    expect(f.requests).toHaveLength(0);
  });

  it.each(["pack", "ship"] as const)(
    "requires refresh when a %s response cannot be decoded",
    async (operation) => {
      const f = submission((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({})))
      );
      const value = form();
      value.set("quantity:line-1", "1");
      await expect(f.run(operation, value)).resolves.toEqual({
        message:
          "The write could not be confirmed. Refresh the Order before trying again.",
        ok: false,
      });
      expect(f.requests).toHaveLength(1);
    }
  );

  it("requires refresh when a submitted write loses its response", async () => {
    const f = submission((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            cause: new Error("Connection reset"),
            request,
          }),
        })
      )
    );
    const value = form();
    value.set("quantity:line-1", "1");
    await expect(f.run("pack", value)).resolves.toEqual({
      message:
        "The write could not be confirmed. Refresh the Order before trying again.",
      ok: false,
    });
    expect(f.requests).toHaveLength(1);
  });

  it("preserves a confirmed conflict response", async () => {
    const f = submission((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            fulfillmentConflict.make({
              message: "Order changed. Refresh before continuing.",
            }),
            { status: 409 }
          )
        )
      )
    );
    const value = form();
    value.set("quantity:line-1", "1");
    await expect(f.run("pack", value)).resolves.toEqual({
      message: "Order changed. Refresh before continuing.",
      ok: false,
    });
  });

  it("confirms a decoded successful write", async () => {
    const f = submission((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            cancelled: false,
            groups: [],
            id: "opaque-order",
            revision: "next-revision",
            writable: true,
          })
        )
      )
    );
    const value = form();
    value.set("quantity:line-1", "1");
    await expect(f.run("pack", value)).resolves.toEqual({
      message: "Delivery packed.",
      ok: true,
    });
  });
});
