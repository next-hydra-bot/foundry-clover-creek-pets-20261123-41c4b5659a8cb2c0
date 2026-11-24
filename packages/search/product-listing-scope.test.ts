import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createProxySearchClient } from "./client";
import { productListingStateMappingFor } from "./product-listing-routing";
import { categorySearchClient } from "./product-listing-scope";

describe("Category listing search", () => {
  it("sends fixed category scope through the browser proxy for products and sort replicas", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ results: [] }));
    try {
      const requests = [
        {
          indexName: "products",
          params: { facetFilters: [["availability:in-stock"]], query: "pack" },
        },
        { indexName: "products@price-desc", params: { page: 2 } },
        { indexName: "content", params: { query: "guide" } },
      ];
      await categorySearchClient(
        createProxySearchClient("/api/search/en-US"),
        "outdoor-packs"
      ).search(requests);
      expect(fetch).toHaveBeenCalledWith(
        "/api/search/en-US",
        expect.objectContaining({ credentials: "same-origin" })
      );
      const body = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
        fetch.mock.calls[0]?.[1]?.body
      );
      expect(body).toEqual({
        requests: [
          {
            indexName: "products",
            params: {
              facetFilters: [
                ["availability:in-stock"],
                "category:outdoor-packs",
              ],
              query: "pack",
            },
          },
          {
            indexName: "products@price-desc",
            params: { facetFilters: ["category:outdoor-packs"], page: 2 },
          },
          requests[2],
        ],
      });
      expect(requests[0]?.params.facetFilters).toEqual([
        ["availability:in-stock"],
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("keeps URL refinements independent of the category selected by the path", () => {
    const mapping = productListingStateMappingFor("outdoor-packs");
    const state = mapping.routeToState({
      category: "unrelated",
      page: 3,
      q: "day",
      sort: "price-asc",
    });
    expect(state.products?.refinementList?.category).toBeUndefined();
    expect(mapping.stateToRoute(state)).toEqual({
      category: undefined,
      page: 3,
      q: "day",
      sort: "price-asc",
    });
  });
});
