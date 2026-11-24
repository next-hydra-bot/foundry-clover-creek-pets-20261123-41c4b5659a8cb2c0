import "server-only";
import { createContentSearchProjection } from "@repo/cms/search";
import type { Locale } from "@repo/i18n";
import { getPathname } from "@repo/i18n/navigation";
import { createSearchProvider } from "@repo/search-provider/composition";
import type {
  SearchAudience,
  SearchBatch,
  SearchBatchResult,
  SearchProvider,
} from "@repo/search/contract";
import { resolveProductSearchAudience } from "@repo/search/product-search-audience";
import { makeSearchRuntime } from "@repo/search/runtime/make-search-runtime";
import type { SearchClientConfiguration } from "@repo/search/runtime/make-search-runtime";
import { cacheLife, cacheTag } from "next/cache";

import { commerceSearchRoutes } from "./commerce-search";

const searchProvider = createSearchProvider({
  contentProjection: createContentSearchProjection,
});

const searchResults = async (
  batch: SearchBatch,
  audience: SearchAudience
): Promise<SearchBatchResult> => {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag("search", `search:${audience.locale}`);
  if (audience.product !== undefined) {
    cacheTag(
      "product-search",
      `product-search:${audience.product.storeKey}:${audience.locale}`
    );
  }

  return await searchProvider.search(batch, audience);
};

const cachedSearchProvider: SearchProvider = {
  search: async (batch, audience, signal) => {
    signal?.throwIfAborted();
    const result = await searchResults(batch, audience);
    signal?.throwIfAborted();
    return result;
  },
};

function getClientConfiguration(locale: Locale): SearchClientConfiguration {
  const commerceRoutes = commerceSearchRoutes(locale);

  return {
    autocompleteRoutes: {
      contentPathPrefix: getPathname({ href: "/", locale }),

      productPathPrefix: commerceRoutes.productPathPrefix,

      searchPath: getPathname({ href: "/search", locale }),
    },
    endpoint: `/api/search/${locale}`,

    productListingPath: commerceRoutes.productListingPath,
  };
}

export const searchRuntime = makeSearchRuntime({
  getClientConfiguration,
  provider: cachedSearchProvider,

  resolveProductAudience: resolveProductSearchAudience,
});
