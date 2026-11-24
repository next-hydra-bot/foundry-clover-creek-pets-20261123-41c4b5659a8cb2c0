import "server-only";
import type { ActionClient } from "@repo/actions";
import { resolveShoppingListBuyer } from "@repo/commerce-core/shopping-lists/web/buyer";
import { Effect, Schema } from "effect";

import type { ShoppingListFailure } from "../../domain/shopping-list";
import type { NextCommerceRequestError } from "../../runtime/bindings";
import type { ShoppingLists } from "../../services/shopping-lists";
import {
  ShoppingListActionError,
  ShoppingListActionSuccess,
  toShoppingListActionError,
} from "./action-contract";
import { ShoppingListCommand, submitShoppingListCommand } from "./command";

export const makeShoppingListProcedure = <
  RuntimeServices,
  Context extends object,
>(
  actions: ActionClient<
    | RuntimeServices
    | ShoppingLists
    | Effect.Services<ReturnType<typeof resolveShoppingListBuyer>>,
    never,
    | RuntimeServices
    | ShoppingLists
    | Effect.Services<ReturnType<typeof resolveShoppingListBuyer>>,
    Context
  >
) =>
  actions
    .procedure("ShoppingLists.save")
    .input(Schema.fromFormData(ShoppingListCommand))
    .output(ShoppingListActionSuccess)
    .error(ShoppingListActionError)
    .mapError<ShoppingListFailure | NextCommerceRequestError>(
      toShoppingListActionError
    )
    .handle((command) =>
      resolveShoppingListBuyer(command.locale).pipe(
        Effect.flatMap((request) =>
          submitShoppingListCommand(command, request)
        ),
        Effect.tapError((error) =>
          Effect.logError("Shopping list operation failed", error)
        ),
        Effect.map((value) => {
          const base = `/${command.locale}/account/shopping-lists`;
          let destination: string | undefined;
          if (
            (command._tag === "Create" || command._tag === "CreateWithItem") &&
            value.id !== undefined
          ) {
            destination = `${base}/${encodeURIComponent(value.id)}`;
          } else if (value.deleted) {
            destination = base;
          }
          return { ...value, destination, locale: command.locale };
        })
      )
    );
