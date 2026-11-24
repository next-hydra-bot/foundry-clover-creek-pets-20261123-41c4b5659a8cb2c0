import "server-only";
import { categoriesPath } from "@repo/commerce-core/product/category-pages";

import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n";
import { Link } from "@repo/i18n/navigation";
import { searchRuntime } from "@repo/search/runtime";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { createServerSearchLocation } from "./instant-search-history";
import { PRODUCT_DISCOVERY } from "./product-discovery";
import { ProductListing } from "./product-listing";
import type { ProductListingRouteState } from "./product-listing-routing";
import { createProductListingUrl } from "./product-listing-routing";
import { getProductListingServerState } from "./product-listing-server";
import { ProductListingSkeleton } from "./product-listing-skeleton";

type SearchParamValue = string | string[] | undefined;

export interface ProductListingPageProps {
  readonly locale: Locale;
  readonly searchParams: Promise<Record<string, SearchParamValue>>;
}

const productListingRouteState = (
  searchParams: Record<string, SearchParamValue>
): ProductListingRouteState => {
  const routeState: ProductListingRouteState = {};
  const keys = [
    ...PRODUCT_DISCOVERY.facets.map(({ route }) => route),
    "page",
    "q",
    "sort",
  ] as const;
  for (const key of keys) {
    const value = searchParams[key];
    if (value !== undefined) {
      routeState[key] = value;
    }
  }
  return routeState;
};

export async function ProductListingResults({
  categoryKey,
  listingPath,
  locale,
  searchParams,
}: ProductListingPageProps & {
  readonly categoryKey?: string;
  readonly listingPath?: string;
}) {
  const { endpoint, productListingPath } =
    searchRuntime.getClientConfiguration(locale);
  if (productListingPath === undefined) {
    throw new Error("Product listing route is not configured");
  }
  const routeState = productListingRouteState(await searchParams);
  if (categoryKey !== undefined) {
    delete routeState.category;
  }
  const serverUrl = createProductListingUrl(
    createServerSearchLocation(listingPath ?? productListingPath),
    routeState
  );
  let serverState:
    | Awaited<ReturnType<typeof getProductListingServerState>>
    | undefined;
  try {
    const audience = await searchRuntime.resolveProductAudience(locale);
    serverState = await getProductListingServerState({
      categoryKey,
      audience,
      provider: searchRuntime,
      routeState,
    });
  } catch (error) {
    unstable_rethrow(error);
    // oxlint-disable-next-line no-console -- Product listing SSR failure falls back to the browser proxy and must remain observable server-side.
    console.error("Product listing server search failed", { error });
  }

  return (
    <ProductListing
      categoryKey={categoryKey}
      endpoint={endpoint}
      locale={locale}
      serverUrl={serverUrl}
      serverState={serverState}
    />
  );
}

export async function ProductListingPage({
  locale,
  searchParams,
}: ProductListingPageProps) {
  const t = await getTranslations({ locale, namespace: "web.categories" });
  return (
    (
      <div className="container py-10 lg:py-14">
        <div className="mb-10 max-w-3xl">
          <p className="mb-2 font-medium text-muted-foreground text-sm uppercase tracking-wide">
            Product catalog
          </p>
          <h1 className="font-semibold text-4xl tracking-tight">Products</h1>
          <p className="mt-3 text-muted-foreground text-base">
            Find products available to you.
          </p>
          <Link
            className="mt-4 inline-block text-sm underline underline-offset-4"
            href={categoriesPath}
            locale={locale}
          >
            {t("title")}
          </Link>
        </div>
        <Suspense fallback={<ProductListingSkeleton />}>
          <ProductListingResults locale={locale} searchParams={searchParams} />
        </Suspense>
      </div>
    )
  );
}
