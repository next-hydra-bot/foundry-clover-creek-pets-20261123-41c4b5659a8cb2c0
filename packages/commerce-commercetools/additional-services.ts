import { shoppingListsLayer } from "@repo/commerce-commercetools/shopping-lists";
import { Layer } from "effect";

export const additionalCommerceServicesLayer = Layer.mergeAll(
  Layer.empty,
  ...[shoppingListsLayer]
);
