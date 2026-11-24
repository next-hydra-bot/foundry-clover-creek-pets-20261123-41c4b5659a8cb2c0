import { describe, expect, it } from "@effect/vitest";
import { AuthUserId } from "@repo/auth-contract/access-token";
import { routing } from "@repo/i18n/routing";
import { Effect, Layer, Schema } from "effect";

import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
} from "../../domain/commerce-account";
import type { ShoppingListBuyer } from "../../domain/shopping-list";
import { ShoppingList } from "../../domain/shopping-list";
import { ShoppingLists } from "../../services/shopping-lists";
import { Store } from "../../store";
import { ShoppingListCommand, submitShoppingListCommand } from "./command";

const buyer = {
  authUserId: AuthUserId.make("site-user"),
};
const companyBuyer = {
  authUserId: buyer.authUserId,

  businessUnit: {
    id: CommerceBusinessUnitId.make("company-a"),
    key: CommerceBusinessUnitKey.make("company-a"),
  },
};
const store = Schema.decodeUnknownSync(Store)({
  currency: "USD",
  locale: routing.defaultLocale,
  storeKey: "store-a",
});
const saved = Schema.decodeUnknownSync(ShoppingList)({
  createdAt: new Date(),
  id: "saved-list",
  items: [],
  name: { en: "Weekly" },
  ownership: { _tag: "Customer", authUserId: buyer.authUserId },
  purpose: "shopping",
  revision: "revision-2",
  storeKey: store.storeKey,
  updatedAt: new Date(),
});
const unused = () => Effect.die("Unexpected ShoppingLists operation");
const scope = {
  businessUnitId: "",
  authUserId: buyer.authUserId,
  locale: store.locale,
  storeKey: "store-a",
};
const target = { ...scope, expectedRevision: "revision-1", id: "saved-list" };

const run = (
  input: Readonly<Record<string, string>>,
  service: typeof ShoppingLists.Service,
  principal: ShoppingListBuyer = buyer
) =>
  Schema.decodeUnknownEffect(ShoppingListCommand)(input).pipe(
    Effect.flatMap((command) =>
      submitShoppingListCommand(command, { buyer: principal, store })
    ),
    Effect.provide(Layer.succeed(ShoppingLists, service))
  );
const service = {
  create: unused,
  delete: unused,
  get: unused,
  list: unused,
  update: unused,
} satisfies typeof ShoppingLists.Service;

describe("Shopping list form commands", () => {
  it.effect("rejects a form retained from a different signed-in customer", () =>
    run(
      {
        ...scope,
        _tag: "Create",
        authUserId: "previous-user",
        name: "Weekly",
      },
      service
    ).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error).toMatchObject({
            _tag: "ShoppingListFailure",
            reason: "accessDenied",
          });
        })
      )
    )
  );

  it.effect(
    "creates an empty localized list for the server-verified buyer",
    () =>
      run(
        {
          ...scope,
          _tag: "Create",
          customerId: "forged-customer",
          name: " Weekly supplies ",
        },
        {
          ...service,
          create: (principal, draft) =>
            Effect.sync(() => {
              expect(principal).toEqual(buyer);
              expect(draft).toEqual({
                items: [],
                name: { [scope.locale]: "Weekly supplies" },
                storeKey: store.storeKey,
              });
              return saved;
            }),
        }
      )
  );

  it.effect("rejects a stale Store before invoking list storage", () =>
    run(
      { ...scope, _tag: "Create", name: "Weekly", storeKey: "another-store" },
      service
    ).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error).toMatchObject({
            _tag: "ShoppingListFailure",
            reason: "accessDenied",
          });
        })
      )
    )
  );

  it.effect("rejects a form from a different selected company", () =>
    run(
      { ...scope, _tag: "Create", businessUnitId: "company-b", name: "Weekly" },
      service,
      companyBuyer
    ).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error).toMatchObject({
            _tag: "ShoppingListFailure",
            reason: "accessDenied",
          });
        })
      )
    )
  );

  it.effect("forwards the exact variant reference and expected revision", () =>
    run(
      {
        ...target,
        _tag: "AddItem",
        quantity: "3",
        variantId: "provider-opaque-variant",
      },
      {
        ...service,
        update: (principal, input) =>
          Effect.sync(() => {
            expect(principal).toEqual(buyer);
            expect(input.expectedRevision).toBe("revision-1");
            expect(input.actions).toEqual([
              expect.objectContaining({
                _tag: "AddItem",
                quantity: 3,
                variantId: "provider-opaque-variant",
              }),
            ]);
            return saved;
          }),
      }
    )
  );

  it.effect("renames only the current locale through the shared service", () =>
    run(
      { ...target, _tag: "Rename", name: " Updated weekly list " },
      {
        ...service,
        update: (_principal, input) =>
          Effect.sync(() => {
            expect(input.actions).toEqual([
              {
                _tag: "SetName",
                locale: scope.locale,
                value: "Updated weekly list",
              },
            ]);
            return saved;
          }),
      }
    )
  );

  it.effect("keeps saved line identity when replacing a quantity", () =>
    run(
      {
        ...target,
        _tag: "SetQuantity",
        lineItemId: "saved-line",
        quantity: "7",
      },
      {
        ...service,
        update: (_principal, input) =>
          Effect.sync(() => {
            expect(input.actions).toEqual([
              expect.objectContaining({
                _tag: "SetQuantity",
                lineItemId: "saved-line",
                quantity: 7,
              }),
            ]);
            return saved;
          }),
      }
    )
  );

  it.effect("deletes using the last read revision", () =>
    run(
      { ...target, _tag: "Delete" },
      {
        ...service,
        delete: (principal, input) =>
          Effect.sync(() => {
            expect(principal).toEqual(buyer);
            expect(input.expectedRevision).toBe("revision-1");
          }),
      }
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result).toEqual({ deleted: true, id: "saved-list" });
        })
      )
    )
  );

  it("rejects invalid quantities at the form boundary", () => {
    for (const quantity of ["0", "-1", "1.5", "Infinity", "not-a-number"]) {
      expect(
        Schema.is(ShoppingListCommand)({
          ...target,
          _tag: "AddItem",
          quantity,
          variantId: "variant",
        })
      ).toBeFalsy();
      expect(
        Schema.decodeUnknownOption(ShoppingListCommand)({
          ...target,
          _tag: "AddItem",
          quantity,
          variantId: "variant",
        })._tag
      ).toBe("None");
    }
  });
});
