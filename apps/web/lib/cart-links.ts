import type { CartFlyoutLinks } from "@repo/commerce-core/cart/cart-flyout";

import { commerceCartLinks } from "./commerce-search";

export const cartLinks: CartFlyoutLinks = Object.assign(
  { productsHref: null },
  ...[commerceCartLinks]
);
