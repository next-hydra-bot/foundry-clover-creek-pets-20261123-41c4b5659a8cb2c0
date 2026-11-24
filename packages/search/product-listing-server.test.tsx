// @vitest-environment node

import { describe, expect, it } from "vitest";

import { searchFacetLabels } from "./contract";
import type { SearchBatch, SearchProvider } from "./contract";
import { getProductListingServerState } from "./product-listing-server";

const audience = {
  locale: "en-US",
  product: {
    currency: "USD",
    priceAudienceIds: ["public"],
    storeKey: "default-store",
  },
} as const;

describe(getProductListingServerState, () => {
  it("keeps every facet and sort request inside the category in the URL", async () => {
    const received: SearchBatch[] = [];
    const provider: SearchProvider = {
      // oxlint-disable-next-line eslint/require-await -- In-process search transport fixture.
      search: async (batch) => {
        received.push(batch);
        return {
          results: batch.map(({ indexName, params }) => ({
            facets: { availability: { "in-stock": 1 } },
            hits: [],
            hitsPerPage: params.hitsPerPage ?? 12,
            index: indexName,
            nbHits: 0,
            nbPages: 0,
            page: params.page ?? 0,
            processingTimeMS: 1,
            query: params.query ?? "",
          })),
        };
      },
    };
    await getProductListingServerState({
      audience,
      provider,
      categoryKey: "outdoor-packs",
      routeState: {
        availability: "in-stock",
        category: "unrelated",
        page: 2,
        sort: "price-asc",
      },
    });
    expect(received).toHaveLength(1);
    const [batch] = received;
    expect(batch?.length).toBeGreaterThan(1);
    for (const request of batch ?? []) {
      expect(request.indexName).toBe("products@price-asc");
      expect(request.params.facetFilters).toContain("category:outdoor-packs");
      expect(JSON.stringify(request.params)).not.toContain("unrelated");
    }
    expect(batch?.[0]?.params.page).toBe(1);
  });

  it("forwards InstantSearch's complete disjunctive-facet batch", async () => {
    const received: SearchBatch[] = [];
    const provider: SearchProvider = {
      // oxlint-disable-next-line eslint/require-await -- The fake preserves the production provider's asynchronous contract while returning deterministic results.
      search: async (batch, receivedAudience) => {
        received.push(batch);
        expect(receivedAudience).toBe(audience);
        return {
          results: batch.map(({ indexName, params }) => ({
            facets: {
              availability: { "in-stock": 2, "out-of-stock": 1 },
              category: { excavators: 2, loaders: 1 },
            },
            facets_stats: {
              price: {
                avg: 6.002,
                max: 10.999,
                min: 1.005,
                sum: 18.006,
              },
            },
            hits: [],
            hitsPerPage: params.hitsPerPage ?? 12,
            index: indexName,
            nbHits: 0,
            nbPages: 0,
            page: params.page ?? 0,
            processingTimeMS: 1,
            query: params.query ?? "",
            userData: [
              {
                facetLabels: {
                  category: {
                    excavators: "Excavatrices",
                    loaders: "Chargeuses",
                  },
                },
              },
            ],
          })),
        };
      },
    };

    const serverState = await getProductListingServerState({
      audience,
      provider,
      routeState: {
        availability: "in-stock",
        category: ["excavators", "loaders"],
        price: "1.005:9.999",
        sort: "price-asc",
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.length).toBeGreaterThan(1);
    expect(received[0]?.[0]?.params.numericFilters).toEqual(
      expect.arrayContaining(["price>=1.005", "price<=9.999"])
    );
    expect(serverState.initialResults.products).toBeDefined();
    expect(
      searchFacetLabels(
        serverState.initialResults.products?.results?.[0]?.userData
      )
    ).toEqual({
      category: { excavators: "Excavatrices", loaders: "Chargeuses" },
    });
  });
});
