import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  AuthSession,
  AuthSessionAdapter,
  AuthSessionReadFailure,
  AuthUser,
} from "@repo/auth-contract/session";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CommerceLocale, resolveStore } from "../../store";
import { resolveShoppingListBuyer } from "./buyer";

const user = new AuthUser({
  email: null,
  firstName: null,
  id: "site-user",
  lastName: null,
  profilePictureUrl: null,
});
const read = async (identity: AuthUser | null) =>
  await Effect.runPromise(
    resolveShoppingListBuyer("en-US").pipe(
      Effect.provideService(AuthSessionAdapter, {
        read: Effect.succeed(
          new AuthSession({ permissions: { has: () => false }, user: identity })
        ),
      })
    )
  );

describe("Customer shopping-list identity", () => {
  it("uses the verified site user and the locale's configured Store", async () => {
    await expect(read(user)).resolves.toEqual({
      buyer: { authUserId: AuthUserId.make(user.id) },
      store: resolveStore({ locale: CommerceLocale.make("en-US") }),
    });
  });

  it("returns no buyer for a signed-out visitor", async () => {
    await expect(read(null)).resolves.toMatchObject({ buyer: undefined });
  });

  it("reports a failed identity verification as unavailable", async () => {
    const result = await Effect.runPromise(
      resolveShoppingListBuyer("en-US").pipe(
        Effect.provideService(AuthSessionAdapter, {
          read: Effect.fail(
            new AuthSessionReadFailure({
              cause: new Error("Identity service unavailable"),
              message: "Verification failed",
              provider: "fixture",
            })
          ),
        }),
        Effect.result
      )
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CommerceAccountUnavailable" },
    });
  });
});
