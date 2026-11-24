import {
  SavedProductList,
  SavedProductRow,
} from "@repo/design-system/components/commerce/saved-product-row";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";

import type { ShoppingList } from "../../domain/shopping-list";
import { CatalogRuntime } from "../../product/catalog-runtime";
import type { ProductVariantCard } from "../../product/model";
import { ProductDiscovery } from "../../product/product-discovery";
import { saveShoppingList } from "./actions";
import { ConnectedShoppingListForm as ShoppingListForm } from "./form";

export const savedProductHref = (locale: Locale, product: ProductVariantCard) =>
  // SAFETY: Both the slug and opaque Variant ID are encoded into a package-owned route.
  `/${locale}/products/${encodeURIComponent(product.slug)}?${new URLSearchParams({ variant: product.id })}` as Route;

/** Catalog failure must leave every saved line visible and removable. */
export async function ShoppingListItems({
  locale,
  list,
  fields,
}: {
  readonly locale: Locale;
  readonly list: ShoppingList;
  readonly fields: Readonly<Record<string, string>>;
}) {
  const t = await getTranslations({ locale, namespace: "web.shoppingLists" });
  const result = await Effect.runPromise(
    Effect.tryPromise(
      async () =>
        await CatalogRuntime.run(
          locale,
          ProductDiscovery.pipe(
            Effect.flatMap((products) =>
              products.findVariantCards(
                list.items.map((item) => item.variantId)
              )
            )
          )
        )
    ).pipe(
      Effect.map((products) => ({ products, unavailable: false })),
      Effect.tapError((error) =>
        Effect.logWarning("Shopping list Product details unavailable", error)
      ),
      Effect.catch(() => Effect.succeed({ products: [], unavailable: true }))
    )
  );
  const products = new Map(
    result.products.map((product) => [product.id, product])
  );
  const labels = {
    pendingLabel: t("saving"),
    refreshLabel: t("refresh"),
    savedLabel: t("saved"),
  };
  return (
    <div>
      {result.unavailable ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {t("catalogUnavailable")}
        </p>
      ) : null}
      <SavedProductList>
        {list.items.map((item) => {
          const product = products.get(item.variantId);
          const image = product?.featuredImage;
          const target = {
            ...fields,
            id: list.id,
            expectedRevision: list.revision,
            lineItemId: item.id,
          };
          return (
            <SavedProductRow
              key={`${item.id}:${list.revision}`}
              media={
                image ? (
                  <Image
                    src={image.url}
                    alt={image.altText ?? product.title}
                    fill
                    sizes="100vw"
                    className="object-contain p-2"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <span className="text-xs">{t("noImage")}</span>
                  </div>
                )
              }
              actions={
                <>
                  {list.purpose === "shopping" ? (
                    <ShoppingListForm
                      action={saveShoppingList}
                      fields={{ ...target, _tag: "SetQuantity" }}
                      label={t("update")}
                      layout="inline"
                      buttonVariant="outline"
                      {...labels}
                    >
                      <div className="grid gap-2">
                        <Label htmlFor={`quantity-${item.id}`}>
                          {t("quantity")}
                        </Label>
                        <Input
                          id={`quantity-${item.id}`}
                          name="quantity"
                          type="number"
                          defaultValue={item.quantity}
                          min="1"
                          max={Number.MAX_SAFE_INTEGER}
                          step="1"
                          required
                          className="w-20 text-foreground"
                        />
                      </div>
                    </ShoppingListForm>
                  ) : null}
                  <ShoppingListForm
                    action={saveShoppingList}
                    fields={{ ...target, _tag: "RemoveItem" }}
                    label={t("remove")}
                    layout="inline"
                    buttonVariant="ghost"
                    {...labels}
                  />
                </>
              }
            >
              {product ? (
                <Link
                  href={savedProductHref(locale, product)}
                  className="font-medium leading-snug hover:underline"
                >
                  {product.title}
                </Link>
              ) : (
                <p className="font-medium">
                  {result.unavailable
                    ? t("productDetailsUnavailable")
                    : t("removedProduct")}
                </p>
              )}
              {product && product.options.length > 0 ? (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {product.options.map((option) => (
                    <div key={option.name} className="flex gap-1">
                      <dt>{option.name}:</dt>
                      <dd>{option.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {product?.sku ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sku")}: {product.sku}
                </p>
              ) : null}
              {product && !product.availability.availableForSale ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("outOfStock")}
                </p>
              ) : null}
              {!product && !result.unavailable ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("removedProductHint")}
                </p>
              ) : null}
            </SavedProductRow>
          );
        })}
      </SavedProductList>
    </div>
  );
}
