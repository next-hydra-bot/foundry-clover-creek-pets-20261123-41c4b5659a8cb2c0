import { AuthUserId } from "@repo/auth-contract/access-token";
import { AuthSessionAdapter } from "@repo/auth-contract/session";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";

import type { ShoppingListBuyer } from "../../domain/shopping-list";
import { CommerceAccountUnavailable } from "../../services/commerce-accounts";
import { CommerceLocale, resolveStore } from "../../store";
import type { Store } from "../../store";

export interface ShoppingListRequest {
  readonly buyer: ShoppingListBuyer | undefined;
  readonly store: Store;
}

/** Customer-owned application data uses the verified site identity directly. */
export const resolveShoppingListBuyer = Effect.fn("ShoppingLists.webBuyer")(
  function* (
    locale: Locale
  ): Effect.fn.Return<
    ShoppingListRequest,
    CommerceAccountUnavailable,
    AuthSessionAdapter
  > {
    const session = yield* AuthSessionAdapter.read.pipe(
      Effect.mapError(
        (cause) =>
          new CommerceAccountUnavailable({
            cause,
            message: "The signed-in user could not be verified.",
          })
      )
    );
    return {
      buyer: session.user
        ? { authUserId: AuthUserId.make(session.user.id) }
        : undefined,
      store: resolveStore({ locale: CommerceLocale.make(locale) }),
    };
  }
);
