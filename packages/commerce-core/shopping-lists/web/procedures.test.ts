import { ActionClient } from "@repo/actions";
import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  AuthSession,
  AuthSessionAdapter,
  AuthUser,
} from "@repo/auth-contract/session";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { CommerceRequestContextNotFound } from "../../domain/commerce-request-context";
import { ShoppingList, ShoppingListFailure } from "../../domain/shopping-list";
import { ShoppingLists } from "../../services/shopping-lists";
import { CommerceLocale, resolveStore } from "../../store";
import {
  ShoppingListActionResult,
  shoppingListFailureMessageKey,
} from "./action-contract";
import { makeShoppingListProcedure } from "./procedures";

const principal = { authUserId: AuthUserId.make("shopper") };
const store = resolveStore({ locale: CommerceLocale.make("en-US") });
const unused = () => Effect.die("Unexpected list operation");
const cleanup: (() => Promise<void>)[] = [];
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    _tag: "SetQuantity",
    businessUnitId: "",
    authUserId: principal.authUserId,
    expectedRevision: "1",
    id: "list",
    lineItemId: "line",
    locale: "en-US",
    quantity: "2",
    storeKey: store.storeKey,
  })) {
    data.set(key, value);
  }
  return data;
};
const actionFor = (
  outcome: ShoppingListFailure | CommerceRequestContextNotFound | ShoppingList
) => {
  const runtime = ManagedRuntime.make(
    Layer.merge(
      Layer.succeed(AuthSessionAdapter, {
        read: Effect.succeed(
          new AuthSession({
            permissions: { has: () => false },
            user:
              "_tag" in outcome &&
              outcome._tag === "CommerceRequestContextNotFound"
                ? null
                : new AuthUser({
                    id: principal.authUserId,
                    email: null,
                    firstName: null,
                    lastName: null,
                    profilePictureUrl: null,
                  }),
          })
        ),
      }),
      Layer.succeed(ShoppingLists, {
        create: unused,
        delete: unused,
        get: unused,
        list: unused,
        update: () => {
          if (!("_tag" in outcome)) {
            return Effect.succeed(outcome);
          }
          return outcome._tag === "ShoppingListFailure"
            ? Effect.fail(outcome)
            : unused();
        },
      })
    )
  );
  cleanup.push(async () => {
    await runtime.dispose();
  });
  const actions = ActionClient.make(runtime);
  return makeShoppingListProcedure(actions).toAction({
    getFailureMessage: shoppingListFailureMessageKey,
  });
};

describe("Shopping list action boundary", () => {
  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).map(async (dispose) => {
        await dispose();
      })
    );
  });

  it.each([
    { reason: "conflict", recovery: "refresh" },
    { reason: "accessDenied", recovery: "request_access" },
    { reason: "invalidInput", recovery: "fix_input" },
    { reason: "limitExceeded", recovery: "fix_input" },
    { reason: "notFound", recovery: "refresh" },
    { reason: "outcomeUnknown", recovery: "refresh" },
    { reason: "unavailable", recovery: "retry" },
  ] as const)(
    "preserves $reason and recovery through serialization",
    async ({ reason, recovery }) => {
      const action = actionFor(
        new ShoppingListFailure({
          cause: new Error("provider-secret"),
          message: "private diagnostic",
          operation: "update",
          reason,
        })
      );
      const result = await action(form());
      const encoded = JSON.stringify(result);
      expect(
        Schema.decodeUnknownSync(ShoppingListActionResult)(JSON.parse(encoded))
      ).toBeDefined();
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          displayMessage: reason,
          error: {
            _tag: "ShoppingListFailure",
            code: "shoppingList.failed",
            operation: "update",
            reason,
            recovery,
          },
        },
      });
      expect(encoded).not.toMatch(/private|provider-secret|"cause"/u);
    }
  );

  it("saves using only verified buyer context and list storage", async () => {
    const now = new Date("2026-11-04T00:00:00Z");
    const list = Schema.decodeUnknownSync(ShoppingList)({
      createdAt: now,
      id: "list",
      items: [],
      name: { "en-US": "Weekly" },
      ownership: { _tag: "Customer", authUserId: principal.authUserId },
      purpose: "shopping",
      revision: "2",
      storeKey: store.storeKey,
      updatedAt: now,
    });
    await expect(actionFor(list)(form())).resolves.toMatchObject({
      _tag: "Success",
      success: { id: list.id, locale: "en-US" },
    });
  });

  it("rejects malformed input before calling storage", async () => {
    const data = form();
    data.set("quantity", "0");
    const action = actionFor(
      new ShoppingListFailure({
        message: "Must not execute",
        operation: "update",
        reason: "unavailable",
      })
    );
    await expect(action(data)).resolves.toMatchObject({
      _tag: "Failure",
      failure: {
        displayMessage: "invalidInput",
        error: { _tag: "InputInvalid", issues: [{ path: ["quantity"] }] },
      },
    });
  });

  it("preserves a request-context failure without exposing its diagnostics", async () => {
    const action = actionFor(
      new CommerceRequestContextNotFound({
        message: "private diagnostic",
        reason: "noPrincipal",
      })
    );
    const result = await action(form());
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        error: {
          _tag: "CommerceRequestContextNotFound",
          reason: "noPrincipal",
          recovery: "refresh",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
  });

  it("treats invalid provider data as a defect", async () => {
    const action = actionFor(
      new ShoppingListFailure({
        message: "Invalid provider response",
        operation: "update",
        reason: "invalidData",
      })
    );
    await expect(action(form())).rejects.toThrow("Invalid provider response");
  });
});
