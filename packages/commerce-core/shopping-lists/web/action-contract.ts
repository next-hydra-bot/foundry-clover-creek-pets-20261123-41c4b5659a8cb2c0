import { makeDisplayActionResultSchema } from "@repo/actions";
import { definePublicError } from "@repo/errors";
import type { InputInvalid } from "@repo/errors";
import { routing } from "@repo/i18n/routing";
import { Schema } from "effect";

import type { ShoppingListFailure } from "../../domain/shopping-list";
import { ShoppingListId } from "../../domain/shopping-list";
import { VariantId } from "../../product/identity";
import type { NextCommerceRequestError } from "../../runtime/bindings";
import {
  ShoppingListPublicFailure,
  toPublicShoppingListFailure,
} from "../public-errors";

const AccountUnavailable = definePublicError({
  category: "unavailable",
  code: "shoppingList.accountUnavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "CommerceAccountUnavailable",
});
const ContextUnavailable = definePublicError({
  category: "not_found",
  code: "shoppingList.contextUnavailable",
  fields: {
    reason: Schema.Literals([
      "noPrincipal",
      "noCustomerMapping",
      "noBuyingContext",
    ]),
  },
  recovery: "refresh",
  status: 404,
  tag: "CommerceRequestContextNotFound",
});
export const ShoppingListActionError = Schema.Union([
  ShoppingListPublicFailure,
  AccountUnavailable.schema,
  ContextUnavailable.schema,
]);
export type ShoppingListActionError = typeof ShoppingListActionError.Type;

/** Project once at the public boundary; provider messages and causes remain private. */
export const toShoppingListActionError = (
  error: ShoppingListFailure | NextCommerceRequestError
): ShoppingListActionError => {
  if (error._tag === "CommerceAccountUnavailable") {
    return AccountUnavailable.make({
      message: "The Customer account is temporarily unavailable.",
    });
  }
  if (error._tag === "CommerceRequestContextNotFound") {
    return ContextUnavailable.make({
      message: "The purchasing context is unavailable.",
      reason: error.reason,
    });
  }
  return toPublicShoppingListFailure(error);
};

export const shoppingListFailureMessageKey = (
  error: ShoppingListActionError | InputInvalid
) => {
  if (error._tag === "InputInvalid") {
    return "invalidInput";
  }
  if (error._tag === "CommerceRequestContextNotFound") {
    return "accessDenied";
  }
  if (error._tag === "CommerceAccountUnavailable") {
    return "unavailable";
  }
  return error.reason === "invalidData" ? "unavailable" : error.reason;
};

export const ShoppingListActionSuccess = Schema.Struct({
  destination: Schema.optional(Schema.NonEmptyString),
  favorite: Schema.optional(
    Schema.Struct({ saved: Schema.Boolean, variantId: VariantId })
  ),
  id: Schema.optional(ShoppingListId),
  locale: Schema.Literals(routing.locales),
});
export const ShoppingListActionResult = makeDisplayActionResultSchema(
  ShoppingListActionSuccess,
  ShoppingListActionError
);
export type ShoppingListActionResult = typeof ShoppingListActionResult.Encoded;
export type ShoppingListAction = (
  form: FormData
) => Promise<ShoppingListActionResult>;
