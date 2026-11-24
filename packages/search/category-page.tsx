import "server-only";
import {
  CategoryPageFrame,
  categoryPath,
  loadCategory,
} from "@repo/commerce-core/product/category-pages";
import type { Locale } from "@repo/i18n";
import { getPathname } from "@repo/i18n/navigation";
import { Suspense } from "react";

import { ProductListingResults } from "./product-listing-page";
import { ProductListingSkeleton } from "./product-listing-skeleton";

export async function CategoryPage({
  locale,
  slug,
  searchParams,
}: {
  readonly locale: Locale;
  readonly slug: string;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const category = await loadCategory(locale, slug);
  return (
    <CategoryPageFrame category={category} locale={locale}>
      <Suspense fallback={<ProductListingSkeleton />}>
        <ProductListingResults
          categoryKey={category.key}
          listingPath={getPathname({
            href: categoryPath(category.slug),
            locale,
          })}
          locale={locale}
          searchParams={searchParams}
        />
      </Suspense>
    </CategoryPageFrame>
  );
}
