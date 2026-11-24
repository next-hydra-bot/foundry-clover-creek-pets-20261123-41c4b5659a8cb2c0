import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  AuthImpersonation,
  ImpersonationAudit,
} from "@repo/auth-contract/impersonation";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

/* oxlint-disable require-await -- Native-client fixtures implement Promise-based SDK operations. */
import {
  AccessTokenVerifier,
  accessTokenVerifierLayerFromAuthenticator,
} from "./access-token";
import { clerkImpersonationLayerWith } from "./impersonation";
import type { ClerkImpersonationClient } from "./impersonation";
import { clerkSessionActor } from "./session";

const userId = AuthUserId.make("customer-1");
const nativeUser = {
  emailAddresses: [{ emailAddress: "customer@example.test", id: "email-1" }],
  firstName: "Customer",
  id: userId,
  imageUrl: "https://example.test/avatar",
  lastName: null,
  primaryEmailAddressId: "email-1",
};
const nativeSession = {
  actor: {
    issuer: "merchant-center",
    reason: "Support",
    session_id: "merchant-session",
    sub: "merchant-staff",
  },
  createdAt: Date.parse("2026-11-02T00:00:00Z"),
  expireAt: Date.parse("2026-11-02T00:30:00Z"),
  id: "session-1",
  status: "ended",
  userId,
};
const client = (
  more: Partial<ClerkImpersonationClient> = {}
): ClerkImpersonationClient => ({
  create: async () => ({
    id: "actor-token-1",
    url: "https://identity.example.test/one-use",
  }),
  findUsers: async () => ({ data: [nativeUser] }),
  getUser: async () => nativeUser,
  sessions: async () => ({ data: [nativeSession], totalCount: 1 }),
  ...more,
});
describe("Clerk impersonation adapter", () => {
  it("retains the signed actor while leaving the token subject as the customer", async () => {
    const result = await Effect.runPromise(
      AccessTokenVerifier.verify("verified-token").pipe(
        Effect.provide(
          accessTokenVerifierLayerFromAuthenticator({
            authenticateAccessToken: async () => ({
              actor: {
                issuer: "admin",
                reason: "Support",
                sub: "support-staff",
              },
              hasPermission: () => false,
              sessionId: "customer-session",
              userId: "customer-1",
            }),
          })
        )
      )
    );
    expect(result).toMatchObject({
      actor: { reason: "Support", subject: "support-staff" },
      authUserId: "customer-1",
      sessionId: "customer-session",
    });
    expect(result.permissions.has("impersonation.start")).toBeFalsy();
  });

  it.each([
    { reason: "invalidInput", status: 400 },
    { reason: "unavailable", status: 403 },
    { reason: "outcomeUnknown", status: 500 },
  ])(
    "classifies a native issuance HTTP $status reply",
    async ({ status, reason }) => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* (yield* AuthImpersonation).launch({
              actor: { issuer: "admin", subject: "staff-1" },
              reason: "Support",
              userId,
            });
          }).pipe(
            Effect.provide(
              clerkImpersonationLayerWith(
                client({
                  create: async () => {
                    throw Object.assign(
                      new Error("Provider rejected the request"),
                      { status }
                    );
                  },
                })
              )
            )
          )
        )
      ).rejects.toMatchObject({ reason });
    }
  );

  it("returns a direct one-use launch and forwards the verified actor separately from the customer", async () => {
    const inputs: unknown[] = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* AuthImpersonation).launch({
          actor: { issuer: "admin", subject: "admin-staff" },
          reason: "Support",
          userId,
        });
      }).pipe(
        Effect.provide(
          clerkImpersonationLayerWith(
            client({
              create: async (input) => {
                inputs.push(input);
                return {
                  id: "ticket-1",
                  url: "https://identity.example.test/one-use",
                };
              },
            })
          )
        )
      )
    );
    expect(result.mode).toBe("direct");
    expect(inputs).toEqual([
      {
        actor: { issuer: "admin", subject: "admin-staff" },
        reason: "Support",
        userId,
      },
    ]);
  });

  it("retains native actor claims and a reason for session audit", async () => {
    const page = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ImpersonationAudit).list({ userId });
      }).pipe(Effect.provide(clerkImpersonationLayerWith(client())))
    );
    expect(page.items[0]).toMatchObject({
      actor: {
        claims: nativeSession.actor,
        provider: "clerk",
        reason: "Support",
        subject: "merchant-staff",
      },
      id: "session-1",
      status: "ended",
      userId,
    });
  });

  it("retains continuation when a page contains only ordinary customer sessions", async () => {
    const page = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ImpersonationAudit).list({ userId });
      }).pipe(
        Effect.provide(
          clerkImpersonationLayerWith(
            client({
              sessions: async () => ({
                data: [{ ...nativeSession, actor: null }],
                totalCount: 2,
              }),
            })
          )
        )
      )
    );
    expect(page).toEqual({ coverage: "history", items: [], nextCursor: "1" });
  });

  it("rejects sessions belonging to another target customer", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ImpersonationAudit).list({ userId });
        }).pipe(
          Effect.provide(
            clerkImpersonationLayerWith(
              client({
                sessions: async () => ({
                  data: [{ ...nativeSession, userId: "different-customer" }],
                  totalCount: 1,
                }),
              })
            )
          )
        )
      )
    ).rejects.toMatchObject({ reason: "invalidData" });
  });

  it("does not promote a malformed signed actor to self-service", () => {
    expect(() =>
      clerkSessionActor({ reason: "Missing actor identity" })
    ).toThrow(/sub/u);
  });
});
