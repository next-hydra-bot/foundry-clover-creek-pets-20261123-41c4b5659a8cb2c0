import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { AuthUserId } from "./access-token";
import {
  AuthImpersonation,
  ImpersonationAudit,
  ImpersonationStaff,
  launchImpersonation,
  readImpersonationHistory,
} from "./impersonation";
import { Permissions } from "./permissions";
import { AuthUser } from "./session";
import { AuthUsers } from "./users";

const userId = AuthUserId.make("customer-native-id");
const actor = {
  issuer: "admin-identity",
  sessionId: "staff-session",
  subject: "staff-1",
};
const user = new AuthUser({
  email: "customer@example.test",
  firstName: null,
  id: userId,
  lastName: null,
  profilePictureUrl: null,
});
describe("Impersonation authorization", () => {
  it("supplies the independently verified staff actor and leaves the target identity intact", async () => {
    const launches: unknown[] = [];
    const result = await Effect.runPromise(
      launchImpersonation({ reason: " Support request ", userId }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Permissions, {
              has: (permission) =>
                Effect.succeed(permission === "impersonation.start"),
            }),
            Layer.succeed(ImpersonationStaff, actor),
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
            })
          )
        )
      )
    );
    expect(result.mode).toBe("direct");
    expect(launches).toEqual([{ actor, reason: "Support request", userId }]);
  });

  it("denies launch before looking up customers or issuing credentials", async () => {
    const launches: unknown[] = [];
    await expect(
      Effect.runPromise(
        launchImpersonation({ reason: "Support", userId }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Permissions, { has: () => Effect.succeed(false) }),
              Layer.succeed(ImpersonationStaff, actor),
              Layer.succeed(AuthUsers, {
                getById: () => Effect.die("Lookup must not occur"),
              }),
              Layer.succeed(AuthImpersonation, {
                launch: (input) => {
                  launches.push(input);
                  return Effect.die("Issuance must not occur");
                },
              })
            )
          )
        )
      )
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(launches).toHaveLength(0);
  });

  it("refuses an audit page containing a different customer", async () => {
    await expect(
      Effect.runPromise(
        readImpersonationHistory({ userId }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Permissions, { has: () => Effect.succeed(true) }),
              Layer.succeed(ImpersonationAudit, {
                list: () =>
                  Effect.succeed({
                    coverage: "history",
                    items: [
                      {
                        actor: {
                          claims: {},
                          provider: "example",
                          subject: "staff",
                        },
                        createdAt: "2026-11-02T00:00:00Z",
                        expiresAt: "2026-11-02T01:00:00Z",
                        id: "session-1",
                        status: "active",
                        userId: AuthUserId.make("another-customer"),
                      },
                    ],
                  }),
              })
            )
          )
        )
      )
    ).rejects.toMatchObject({ reason: "invalidData" });
  });

  it("allows an archive adapter without depending on a native provider", async () => {
    const page = await Effect.runPromise(
      readImpersonationHistory({ userId }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Permissions, { has: () => Effect.succeed(true) }),
            Layer.succeed(ImpersonationAudit, {
              list: () =>
                Effect.succeed({
                  coverage: "history",
                  items: [],
                  nextCursor: "archive-page-2",
                }),
            })
          )
        )
      )
    );
    expect(page).toEqual({
      coverage: "history",
      items: [],
      nextCursor: "archive-page-2",
    });
  });
});
