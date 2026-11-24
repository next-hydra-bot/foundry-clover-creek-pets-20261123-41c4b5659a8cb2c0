import { customerProfileNavigation } from "@repo/commerce-b2c/customer-account/navigation";
import type { CustomerAccountSection } from "@repo/commerce-core/customer-account/navigation";
import { orderHistoryNavigation } from "@repo/commerce-core/orders/navigation";
import { shoppingListNavigation } from "@repo/commerce-core/shopping-lists/web/navigation";
export const accountNavigationSections: readonly CustomerAccountSection[] = [
  orderHistoryNavigation,
  shoppingListNavigation,
  customerProfileNavigation,
];
