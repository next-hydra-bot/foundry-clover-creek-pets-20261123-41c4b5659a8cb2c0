import type { SearchClient } from "instantsearch.js";

import { isProductIndexAlias } from "./product-contract";

/** Applied after InstantSearch builds its facet queries so none can drop the page's category. */
export const categorySearchRequests = (
  requests: Parameters<SearchClient["search"]>[0],
  categoryKey: string
): Parameters<SearchClient["search"]>[0] =>
  requests.map((request) => {
    if (!isProductIndexAlias(request.indexName)) {
      return request;
    }
    const filters = request.params?.facetFilters ?? [];
    const existingFilters = Array.isArray(filters) ? filters : [filters];
    const value = categoryKey.startsWith("-")
      ? `\\${categoryKey}`
      : categoryKey;
    return {
      ...request,
      params: {
        ...request.params,
        facetFilters: [...existingFilters, `category:${value}`],
      },
    };
  });

export const categorySearchClient = (
  client: SearchClient,
  categoryKey: string
): SearchClient => ({
  ...client,
  search: async (requests) =>
    await client.search(categorySearchRequests(requests, categoryKey)),
});
