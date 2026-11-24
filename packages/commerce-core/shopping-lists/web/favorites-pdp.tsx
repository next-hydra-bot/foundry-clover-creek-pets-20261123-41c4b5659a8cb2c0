import { NextCommerce } from "@repo/commerce-core/shopping-lists/web/bindings";
import { resolveShoppingListBuyer } from "@repo/commerce-core/shopping-lists/web/buyer";
import { getTranslations } from "@repo/i18n";
import { Effect, Option } from "effect";
import Link from "next/link";
import { Suspense } from "react";

import type { ProductDetailExtensionProps } from "../../product/product-detail-extensions";
import { ShoppingLists } from "../../services/shopping-lists";
import { FavoritesButton, ProductListPicker } from "./favorites-button";
import { shoppingListHref, shoppingListName } from "./pages";

/** Personalized list reads are streamed separately from public catalog content and purchase controls. */
async function FavoriteProductDetailContent({
  locale,
  product,
}: ProductDetailExtensionProps) {
  const t = await getTranslations({ locale, namespace: "web.shoppingLists" });
  const result = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const context = yield* resolveShoppingListBuyer(locale);
      if (!context.buyer) {
        return { kind: "anonymous" as const };
      }
      const principal = context.buyer;
      const lists = yield* ShoppingLists;
      const { storeKey } = context.store;
      const [favorites, page] = yield* Effect.all(
        [
          lists.get(principal, { purpose: "favorites", storeKey }),
          lists.list(principal, { limit: 50, ownership: "mine", storeKey }),
        ],
        { concurrency: "unbounded" }
      );
      const ids = new Set(product.variants.map((variant) => variant.id));
      return {
        choices: page.items
          .filter((list) => list.purpose !== "favorites")
          .map((list) => ({
            id: list.id,
            name: shoppingListName(list.name, locale),
            revision: list.revision,
          })),
        authUserId: principal.authUserId,
        initialVariantIds: Option.isSome(favorites)
          ? favorites.value.items
              .filter((item) => ids.has(item.variantId))
              .map((item) => item.variantId)
          : [],
        kind: "ready" as const,
        revision: Option.isSome(favorites) ? favorites.value.revision : "empty",
        scope: {
          businessUnitId: principal.businessUnit?.id ?? "",
          authUserId: principal.authUserId,
          locale,
          storeKey,
        },
      };
    }).pipe(
      Effect.catch((error) => Effect.succeed({ error, kind: "error" as const }))
    )
  );
  if (result.kind === "anonymous") {
    return (
      <a
        href={shoppingListHref(locale)}
        className="mt-4 block text-sm underline"
      >
        {t("continueToLists")}
      </a>
    );
  }
  if (result.kind === "error") {
    return (
      <div className="mt-4 text-sm">
        <p role="status">{t("unavailable")}</p>
        <Link href={shoppingListHref(locale)} className="underline">
          {t("title")}
        </Link>
      </div>
    );
  }
  const labels = {
    add: t("addFavorite"),
    chooseVariant: t("chooseVariant"),
    create: t("createWithItem"),
    favorites: t("favorites"),
    name: t("name"),
    otherList: t("otherList"),
    refresh: t("refresh"),
    remove: t("removeFavorite"),
    save: t("addItem"),
    saved: t("saved"),
    saving: t("saving"),
  };
  return (
    <section
      className="mt-4 grid gap-3"
      key={JSON.stringify([result.authUserId, result.scope])}
      aria-label={t("title")}
    >
      <FavoritesButton
        key={result.revision}
        fields={result.scope}
        initialVariantIds={result.initialVariantIds}
        labels={labels}
      />
      <ProductListPicker
        fields={result.scope}
        labels={labels}
        choices={result.choices}
      />
      <Link
        href={shoppingListHref(locale)}
        className="text-sm underline underline-offset-4"
      >
        {t("title")}
      </Link>
    </section>
  );
}

export function FavoriteProductDetail(props: ProductDetailExtensionProps) {
  return (
    <Suspense
      fallback={
        <div
          className="mt-4 h-28 animate-pulse rounded-md bg-muted"
          aria-busy="true"
        />
      }
    >
      <FavoriteProductDetailContent {...props} />
    </Suspense>
  );
}
