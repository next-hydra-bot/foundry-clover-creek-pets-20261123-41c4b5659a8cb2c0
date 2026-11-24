import { runInNewContext } from "node:vm";

import { decodeProductModel } from "@repo/commerce-core/catalog/product-model";
import { createCanonicalContentSearchProjection } from "@repo/search/content-search-projection";
import { describe, expect, it, vi } from "vitest";

import { algoliaProductFacetFields } from "../../product-facet-fields";
import { createAlgoliaSearchProvider } from "../../product-provider";
import type { AlgoliaSearchProviderOptions } from "../../provider";
import { ALGOLIA_COMMERCETOOLS_TRANSFORMATION_SOURCE } from "./generated-transform";
import {
  serializeAlgoliaCommercetoolsTransformationConfiguration,
  transform,
} from "./transform";
import type { AlgoliaCommercetoolsTransformationConfiguration } from "./transform";

const configuration: AlgoliaCommercetoolsTransformationConfiguration = {
  attributeFacets: [
    { enumKeys: [], key: "capacity", list: false, type: "number" },
    { enumKeys: [], key: "count", list: false, type: "integer" },
    { enumKeys: [], key: "insulated", list: false, type: "boolean" },
    { enumKeys: [], key: "instruction", list: false, type: "text" },
    { enumKeys: ["BLUE", "RED"], key: "color", list: false, type: "enum" },
    { enumKeys: [], key: "tags", list: true, type: "text" },
    {
      enumKeys: [],
      key: "relatedProducts",
      list: true,
      type: "product-reference",
    },
  ],
  defaultLocale: "en-US",
  priceCustomerGroupIds: ["gold"],
};
const record = {
  attributes: { capacity: 20 },
  name: { "en-US": "Attachment" },
  objectID: "product-1",
  slug: { "en-US": "attachment" },
  variants: [
    {
      attributes: {
        capacity: 0,
        color: { key: "BLUE", label: { "en-US": "Blue", "fr-CA": "Bleu" } },
        count: 0,
        insulated: false,
        instruction: { "en-US": "Wash cold", "fr-CA": "Laver à froid" },
        relatedProducts: [
          { id: "related-product", typeId: "product" as const },
        ],
        tags: ["outdoor", "washable"],
      },
      id: "variant-1",
      isInStock: true,
      prices: {
        USD: {
          min: 8000,
          priceValues: [
            { id: "public-1", value: 10_000 },
            { customerGroupID: "gold", id: "gold-1", value: 8000 },
          ],
        },
      },
    },
    {
      attributes: {
        color: "RED",
        count: 4,
        insulated: true,
        tags: ["outdoor"],
      },
      id: "variant-2",
      isInStock: false,
      prices: {
        USD: { min: 9000, priceValues: [{ id: "public-2", value: 9000 }] },
      },
    },
  ],
};
const helper = {
  secrets: {
    get: () =>
      serializeAlgoliaCommercetoolsTransformationConfiguration(configuration),
  },
};

describe("commercetools Product Model search facets", () => {
  it("projects typed product-family values into every pricing audience using the uploaded transformation", async () => {
    const documents = await transform(record, helper);
    const uploaded: unknown = await runInNewContext(
      `${ALGOLIA_COMMERCETOOLS_TRANSFORMATION_SOURCE}; transform(record, helper)`,
      { helper, record },
      { timeout: 1000 }
    );
    expect(uploaded).toEqual(documents);
    expect(documents).toHaveLength(2);
    expect(documents[0]?.attributeFacets).toMatchObject({
      "en-US": {
        capacity: [0, 20],
        color: ["BLUE", "RED"],
        count: [0, 4],
        insulated: [false, true],
        instruction: ["Wash cold"],
        relatedProducts: ["related-product"],
        tags: ["outdoor", "washable"],
      },
      "fr-CA": { instruction: ["Laver à froid"], color: ["BLUE", "RED"] },
      "en-CA": { instruction: ["Wash cold"] },
    });
    expect(documents[1]?.attributeFacets).toEqual(
      documents[0]?.attributeFacets
    );
    expect(documents.map(({ price }) => price?.USD)).toEqual([90, 80]);
  });

  it("maps model refinements, ranges and facet responses for the selected locale and pricing audience", async () => {
    const model = decodeProductModel({
      defaultLocale: "en-US",
      schemaVersion: 1,
      productTypes: [
        {
          key: "fixture",
          description: "",
          labels: { "en-US": "Fixture" },
          variantOptions: [],
          attributes: [
            {
              key: "capacity",
              type: "number",
              required: false,
              labels: { "en-US": "Capacity" },
            },
            {
              key: "color",
              type: "enum",
              required: false,
              labels: { "en-US": "Color" },
              values: [
                { key: "BLUE", labels: { "en-US": "Blue", "fr-CA": "Bleu" } },
              ],
            },
          ],
        },
      ],
    });
    const search = vi
      .fn<AlgoliaSearchProviderOptions["client"]["search"]>()
      .mockResolvedValue({
        results: [
          {
            hits: [],
            facets: { "attributeFacets.fr-CA.color": { BLUE: 1 } },
            facets_stats: {
              "attributeFacets.fr-CA.capacity": {
                min: 0,
                max: 20,
                avg: 10,
                sum: 20,
              },
            },
          },
        ],
      });
    const provider = createAlgoliaSearchProvider({
      client: { search },
      contentProjection: createCanonicalContentSearchProjection("content"),
      indices: {
        products: () => "products",
        priceAscending: () => "price-asc",
        priceDescending: () => "price-desc",
        querySuggestions: () => "suggestions",
      },
      priceCustomerGroupIds: ["gold"],
      productFacetFields: () =>
        algoliaProductFacetFields("fr-CA", "USD", model),
    });
    const result = await provider.search(
      [
        {
          indexName: "products",
          params: {
            facets: ["attribute.color", "attribute.capacity"],
            facetFilters: ["attribute.color:BLUE"],
            numericFilters: ["attribute.capacity>=0"],
          },
        },
      ],
      {
        locale: "fr-CA",
        product: {
          currency: "USD",
          storeKey: "test",
          priceAudienceIds: ["group:gold"],
        },
      }
    );
    expect(search.mock.calls).toMatchObject([
      [
        {
          requests: [
            {
              filters: 'priceAudienceIds:"group:gold"',
              facets: [
                "attributeFacets.fr-CA.color",
                "attributeFacets.fr-CA.capacity",
              ],
              facetFilters: ["attributeFacets.fr-CA.color:BLUE"],
              numericFilters: ["attributeFacets.fr-CA.capacity>=0"],
              restrictSearchableAttributes: [
                "productCard.title.fr-CA",
                "productCard.description.fr-CA",
                "categories.label.fr-CA",
                "attributeFacets.fr-CA",
              ],
            },
          ],
        },
      ],
    ]);
    expect(result.results[0]).toMatchObject({
      facets: { "attribute.color": { BLUE: 1 } },
      facets_stats: { "attribute.capacity": { min: 0, max: 20 } },
    });
  });

  it.each([
    { capacity: "20" },
    { count: 1.5 },
    { insulated: "false" },
    { color: "Bleu" },
    { tags: "outdoor" },
    { relatedProducts: [{ id: "category-1", typeId: "category" }] },
  ])(
    "rejects malformed typed facets without recovering enum keys from labels: %j",
    async (attributes) => {
      await expect(
        runInNewContext(
          `${ALGOLIA_COMMERCETOOLS_TRANSFORMATION_SOURCE}; transform(record, helper)`,
          {
            helper,
            record: { ...record, variants: [{ id: "invalid", attributes }] },
          },
          { timeout: 1000 }
        )
      ).rejects.toThrow(/attribute facet|Expected a list/u);
    }
  );
});
