import type { CartFlyoutLinks } from "@repo/commerce-core/cart/cart-flyout";
import type { Locale } from "@repo/i18n";
import { getPathname } from "@repo/i18n/navigation";
import type { Route } from "next";

export const commerceCartLinks = {
  // SAFETY: Commerce Search installs this destination; locale routing adds its prefix.
  productsHref: "/products" as Route,
} satisfies CartFlyoutLinks;

export const commerceSearchRoutes = (locale: Locale) => ({
  productListingPath: getPathname({ href: "/products", locale }),
  productPathPrefix: getPathname({ href: "/products", locale }),
});
