"use server";

import { Actions } from "@repo/commerce-core/shopping-lists/web/bindings";
import { getTranslations } from "@repo/i18n";
import { revalidatePath } from "next/cache";

import { shoppingListFailureMessageKey } from "./action-contract";
import type { ShoppingListActionResult } from "./action-contract";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Constructs an Action procedure over the selected application runtime.
import { makeShoppingListProcedure } from "./procedures";

const action = makeShoppingListProcedure(Actions).toAction({
  getFailureMessage: async (error, { locale }) => {
    const t = await getTranslations({ locale, namespace: "web.shoppingLists" });
    return t(shoppingListFailureMessageKey(error));
  },
  onSuccess: ({ locale, id }) => {
    const base = `/${locale}/account/shopping-lists`;
    revalidatePath(base);
    if (id) {
      revalidatePath(`${base}/${encodeURIComponent(id)}`);
    }
  },
});

export async function saveShoppingList(
  form: FormData
): Promise<ShoppingListActionResult> {
  return await action(form);
}
