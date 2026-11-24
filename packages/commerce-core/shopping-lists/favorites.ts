import { Effect, Option } from "effect";

import type {
  ShoppingListBuyer,
  ShoppingListText,
} from "../domain/shopping-list";
import type { VariantId } from "../product/identity";
import { ShoppingLists } from "../services/shopping-lists";
import type { StoreKey } from "../store";

/** Set intent is idempotent. Only confirmed revision/creation conflicts are retried. */
export const setFavorite = Effect.fn("ShoppingLists.setFavorite")(
  function* (
    principal: ShoppingListBuyer,
    input: {
      readonly storeKey: StoreKey;
      readonly variantId: VariantId;
      readonly saved: boolean;
      readonly name: typeof ShoppingListText.Type;
    }
  ) {
    const lists = yield* ShoppingLists;
    const current = yield* lists.get(principal, {
      purpose: "favorites",
      storeKey: input.storeKey,
    });
    if (Option.isNone(current)) {
      if (!input.saved) {
        return Option.none();
      }
      return Option.some(
        yield* lists.create(principal, {
          items: [{ quantity: 1, variantId: input.variantId }],
          name: input.name,
          purpose: "favorites",
          storeKey: input.storeKey,
        })
      );
    }
    const existing = current.value.items.find(
      (item) => item.variantId === input.variantId
    );
    const target = {
      expectedRevision: current.value.revision,
      id: current.value.id,
      storeKey: input.storeKey,
    };
    if (input.saved) {
      if (existing) {
        return current;
      }
      return Option.some(
        yield* lists.update(principal, {
          ...target,
          actions: [
            { _tag: "AddItem", quantity: 1, variantId: input.variantId },
          ],
        })
      );
    }
    if (!existing) {
      return current;
    }
    return Option.some(
      yield* lists.update(principal, {
        ...target,
        actions: [{ _tag: "RemoveItem", lineItemId: existing.id }],
      })
    );
  },
  Effect.retry({ times: 2, while: (error) => error.reason === "conflict" })
);
