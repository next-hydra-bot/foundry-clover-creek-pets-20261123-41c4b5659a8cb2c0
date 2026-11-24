import type { CustomerAreaNavigationItem } from "@repo/design-system/components/layout/customer-area";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";

export const shoppingListNavigation = async (
  locale: Locale
): Promise<readonly CustomerAreaNavigationItem[]> => {
  const t = await getTranslations({ locale, namespace: "web.shoppingLists" });
  return [{ href: `/${locale}/account/shopping-lists`, label: t("title") }];
};
