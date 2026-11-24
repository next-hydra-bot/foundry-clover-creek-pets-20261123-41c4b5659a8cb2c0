import { AuthUserId } from "@repo/auth-contract/access-token";
import { routing } from "@repo/i18n/routing";
import { Effect, Option, Schema } from "effect";

import { CommerceRequestContextNotFound } from "../../domain/commerce-request-context";
import {
  ShoppingListFailure,
  ShoppingListId,
  ShoppingListLineItemId,
  ShoppingListRevision,
} from "../../domain/shopping-list";
import { VariantId } from "../../product/identity";
import { ShoppingLists } from "../../services/shopping-lists";
import { StoreKey } from "../../store";
import { setFavorite } from "../favorites";
import type { ShoppingListRequest } from "./buyer";

const scope = {
  businessUnitId: Schema.String,
  authUserId: AuthUserId,
  locale: Schema.Literals(routing.locales),
  storeKey: StoreKey,
};
const target = {
  ...scope,
  expectedRevision: ShoppingListRevision,
  id: ShoppingListId,
};
const name = Schema.NonEmptyString.check(
  Schema.isMaxLength(255),
  Schema.makeFilter((value) => value.trim().length > 0)
);
const quantity = Schema.FiniteFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);
export const ShoppingListCommand = Schema.Union([
  Schema.TaggedStruct("Create", { ...scope, name }),
  Schema.TaggedStruct("CreateWithItem", {
    ...scope,
    name,
    quantity,
    variantId: VariantId,
  }),
  Schema.TaggedStruct("Favorite", {
    ...scope,
    name,
    saved: Schema.Literals(["true", "false"]),
    variantId: VariantId,
  }),
  Schema.TaggedStruct("Rename", { ...target, name }),
  Schema.TaggedStruct("AddItem", { ...target, quantity, variantId: VariantId }),
  Schema.TaggedStruct("SetQuantity", {
    ...target,
    lineItemId: ShoppingListLineItemId,
    quantity,
  }),
  Schema.TaggedStruct("RemoveItem", {
    ...target,
    lineItemId: ShoppingListLineItemId,
  }),
  Schema.TaggedStruct("Delete", target),
]);
export type ShoppingListCommand = typeof ShoppingListCommand.Type;

/** Submitted scope is a stale-form guard. Only the server-resolved principal establishes authority. */
export const submitShoppingListCommand = Effect.fn("ShoppingLists.submitForm")(
  function* (command: ShoppingListCommand, context: ShoppingListRequest) {
    const principal = context.buyer;
    if (!principal) {
      return yield* new CommerceRequestContextNotFound({
        reason: "noPrincipal",
        message: "Sign in to manage shopping lists.",
      });
    }
    const company = principal.businessUnit?.id ?? "";
    let operation: "create" | "update" | "delete" = "update";
    if (command._tag === "Create" || command._tag === "CreateWithItem") {
      operation = "create";
    }
    if (command._tag === "Delete") {
      operation = "delete";
    }
    if (
      command.storeKey !== context.store.storeKey ||
      command.authUserId !== principal.authUserId ||
      command.businessUnitId !== company
    ) {
      return yield* new ShoppingListFailure({
        message:
          "The purchasing context changed. Refresh the page before saving.",
        operation,
        reason: "accessDenied",
      });
    }
    const lists = yield* ShoppingLists;
    if (command._tag === "Favorite") {
      const saved = command.saved === "true";
      const list = yield* setFavorite(principal, {
        name: { [command.locale]: command.name },
        saved,
        storeKey: command.storeKey,
        variantId: command.variantId,
      });
      return {
        deleted: false,
        favorite: { saved, variantId: command.variantId },
        id: Option.isSome(list) ? list.value.id : undefined,
      };
    }
    if (command._tag === "Create" || command._tag === "CreateWithItem") {
      const created = yield* lists.create(principal, {
        items:
          command._tag === "CreateWithItem"
            ? [{ quantity: command.quantity, variantId: command.variantId }]
            : [],
        name: { [command.locale]: command.name.trim() },
        storeKey: command.storeKey,
      });
      return { deleted: false, id: created.id };
    }
    if (command._tag === "Delete") {
      yield* lists.delete(principal, command);
      return { deleted: true, id: command.id };
    }
    const action =
      command._tag === "Rename"
        ? {
            _tag: "SetName" as const,
            locale: command.locale,
            value: command.name.trim(),
          }
        : command;
    const updated = yield* lists.update(principal, {
      ...command,
      actions: [action],
    });
    return { deleted: false, id: updated.id };
  }
);
