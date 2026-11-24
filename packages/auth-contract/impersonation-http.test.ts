import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { AuthUserId } from "./access-token";
import {
  AuthImpersonation,
  ImpersonationAudit,
  ImpersonationDirectory,
  ImpersonationFailure,
} from "./impersonation";
import {
  ImpersonationAuthentication,
  makeImpersonationHttpHandler,
} from "./impersonation-http";
import { AuthUser } from "./session";
import { AuthUsers } from "./users";

const user = new AuthUser({
  email: "customer@example.test",
  firstName: null,
  id: "customer-1",
  lastName: null,
  profilePictureUrl: null,
});
const fixture = (permissions: readonly string[]) => {
  const launches: unknown[] = [];
  const handler = makeImpersonationHttpHandler({
    authentication: Layer.succeed(ImpersonationAuthentication, {
      authenticate: ({ bearer }) =>
        bearer === "merchant-token"
          ? Effect.succeed({
              actor: { issuer: "merchant-center", subject: "verified-staff" },
              permissions: {
                has: (permission) =>
                  Effect.succeed(permissions.includes(permission)),
              },
            })
          : Effect.fail(new ImpersonationFailure({ reason: "unauthorized" })),
    }),
    services: Layer.mergeAll(
      Layer.succeed(AuthUsers, {
        getById: () => Effect.succeed({ emailVerified: true, user }),
      }),
      Layer.succeed(AuthImpersonation, {
        launch: (input) => {
          launches.push(input);
          return Effect.succeed({
            mode: "direct",
            url: "https://identity.example.test/one-use",
          });
        },
      }),
      Layer.succeed(ImpersonationDirectory, {
        find: () => Effect.succeed([user]),
      }),
      Layer.succeed(ImpersonationAudit, {
        list: () => Effect.succeed({ coverage: "history", items: [] }),
      })
    ),
  });
  return { launches, run: handler.handler };
};
const url = "https://api.example.test/api/auth/impersonation";
describe("Impersonation merchant HTTP contract", () => {
  it("authenticates reads and avoids caching identity or launch data", async () => {
    const f = fixture(["impersonation.read"]);
    const anonymous = await f.run(new Request(`${url}/users?query=customer-1`));
    expect(anonymous.status).toBe(401);
    const reply = await f.run(
      new Request(`${url}/users?query=customer-1`, {
        headers: { authorization: "Bearer merchant-token" },
      })
    );
    expect(reply.status).toBe(200);
    expect(reply.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires start permission independently of read permission", async () => {
    const f = fixture(["impersonation.read"]);
    const reply = await f.run(
      new Request(`${url}/launch`, {
        body: JSON.stringify({ reason: "Support", userId: "customer-1" }),
        headers: {
          authorization: "Bearer merchant-token",
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    expect(reply.status).toBe(403);
    expect(f.launches).toHaveLength(0);
  });

  it("ignores submitted staff claims and uses the verified merchant actor", async () => {
    const f = fixture(["impersonation.start"]);
    const reply = await f.run(
      new Request(`${url}/launch`, {
        body: JSON.stringify({
          actor: { subject: "forged-staff" },
          reason: "Support",
          userId: "customer-1",
        }),
        headers: {
          authorization: "Bearer merchant-token",
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    expect(reply.status).toBe(200);
    expect(f.launches).toEqual([
      {
        actor: { issuer: "merchant-center", subject: "verified-staff" },
        reason: "Support",
        userId: AuthUserId.make("customer-1"),
      },
    ]);
  });

  it("does not issue a launch for malformed input", async () => {
    const f = fixture(["impersonation.start"]);
    const reply = await f.run(
      new Request(`${url}/launch`, {
        body: "{",
        headers: { authorization: "Bearer merchant-token" },
        method: "POST",
      })
    );
    expect(reply.status).toBe(400);
    expect(f.launches).toHaveLength(0);
  });

  it("returns a private unavailable response when a runtime service cannot initialize", async () => {
    const api = makeImpersonationHttpHandler({
      authentication: Layer.effect(
        ImpersonationAuthentication,
        Effect.fail(new Error("Private provider initialization detail"))
      ),
      services: Layer.mergeAll(
        Layer.effect(
          AuthUsers,
          Effect.fail(new Error("Private provider detail"))
        ),
        Layer.effect(
          AuthImpersonation,
          Effect.fail(new Error("Private provider detail"))
        ),
        Layer.effect(
          ImpersonationAudit,
          Effect.fail(new Error("Private provider detail"))
        ),
        Layer.effect(
          ImpersonationDirectory,
          Effect.fail(new Error("Private provider detail"))
        )
      ),
    });
    try {
      const response = await api.handler(
        new Request(`${url}/users?query=customer-1`, {
          headers: { authorization: "Bearer merchant-token" },
        })
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ reason: "unavailable" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      await api.dispose();
    }
  });
});
