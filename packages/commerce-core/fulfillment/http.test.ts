import {
  AccessTokenInvalid,
  AccessTokenVerifier,
  AuthUserId,
  VerifiedAccessToken,
  authPermissionsFrom,
} from "@repo/auth-contract/access-token";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { fulfillmentAdminAuthenticationLayer } from "./authentication";
import { makeFulfillmentHttpHandler } from "./http";
import { FulfillmentFailure, FulfillmentOrder } from "./model";
import { OrderFulfillment } from "./service";

const order = Schema.decodeSync(FulfillmentOrder)({
  cancelled: false,
  groups: [],
  id: "order-1",
  revision: "1",
  writable: true,
});
const fixture = (
  permissions: readonly string[],
  failure?: FulfillmentFailure
) => {
  const writes: string[] = [];
  const fulfill = Layer.succeed(OrderFulfillment, {
    get: () => (failure ? Effect.fail(failure) : Effect.succeed(order)),
    list: () => Effect.succeed({ items: [] }),
    pack: () =>
      Effect.sync(() => {
        writes.push("pack");
        return order;
      }),
    ship: () =>
      Effect.sync(() => {
        writes.push("ship");
        return order;
      }),
  });
  const verifier = Layer.succeed(AccessTokenVerifier, {
    verify: (token) =>
      token === "valid-admin-token"
        ? Effect.succeed(
            new VerifiedAccessToken({
              authUserId: AuthUserId.make("merchant-1"),
              organizationId: "admin-org",
              permissions: authPermissionsFrom(permissions),
            })
          )
        : Effect.fail(
            new AccessTokenInvalid({
              message: "Wrong identity",
              reason: "invalidToken",
            })
          ),
  });
  const transport = makeFulfillmentHttpHandler({
    authentication: fulfillmentAdminAuthenticationLayer.pipe(
      Layer.provide(verifier)
    ),
    basePath: "/api/commerce/fulfillment",
    fulfillment: fulfill,
  });
  const request = async (
    path: string,
    payload?: Schema.Json,
    token = "valid-admin-token"
  ) =>
    await transport.handler(
      new Request(
        `https://store.example.test/api/commerce/fulfillment${path}`,
        {
          body: payload === undefined ? undefined : JSON.stringify(payload),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-project-key": "forged-project",
            "x-user-permissions": "fulfillment.manage",
          },
          method: payload === undefined ? "GET" : "POST",
        }
      )
    );
  return { ...transport, request, writes };
};
describe("merchant fulfillment HTTP contract", () => {
  it("rejects invalid identities even with forwarded permission headers", async () => {
    const f = fixture(["fulfillment.read"]);
    try {
      const response = await f.request(
        "/orders",
        undefined,
        "storefront-token"
      );
      expect(response.status).toBe(401);
    } finally {
      await f.dispose();
    }
  });

  it("enforces read and manage separately and never trusts forwarded grants", async () => {
    const f = fixture(["fulfillment.read"]);
    try {
      const listed = await f.request("/orders");
      expect(listed.status).toBe(200);
      const denied = await f.request(
        "/orders/order-1/deliveries?locale=en-US",
        {
          groupId: "group",
          items: [{ lineItemId: "line", quantity: 1 }],
          revision: "1",
        }
      );
      expect(denied.status).toBe(403);
      expect(f.writes).toEqual([]);
    } finally {
      await f.dispose();
    }
  });

  it("uses the same typed command for any authenticated HTTP client", async () => {
    const f = fixture(["fulfillment.manage"]);
    try {
      const response = await f.request(
        "/orders/order-1/deliveries?locale=en-US",
        {
          groupId: "group",
          items: [{ lineItemId: "line", quantity: 1 }],
          revision: "1",
        }
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: "order-1",
        revision: "1",
      });
      expect(f.writes).toEqual(["pack"]);
    } finally {
      await f.dispose();
    }
  });

  it("rejects duplicate lines and negative quantities before a write", async () => {
    const f = fixture(["fulfillment.manage"]);
    try {
      const response = await f.request(
        "/orders/order-1/deliveries?locale=en-US",
        {
          groupId: "group",
          items: [
            { lineItemId: "line", quantity: -1 },
            { lineItemId: "line", quantity: 1 },
          ],
          revision: "1",
        }
      );
      expect(response.status).toBe(400);
      expect(f.writes).toEqual([]);
    } finally {
      await f.dispose();
    }
  });

  it("returns refresh guidance without exposing native causes", async () => {
    const f = fixture(
      ["fulfillment.read"],
      new FulfillmentFailure({
        cause: "PRIVATE credential payload",
        message: "PRIVATE",
        reason: "outcomeUnknown",
      })
    );
    try {
      const response = await f.request("/orders/order-1?locale=en-US");
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "fulfillment.outcomeUnknown",
        recovery: "refresh",
      });
    } finally {
      await f.dispose();
    }
  });
});
