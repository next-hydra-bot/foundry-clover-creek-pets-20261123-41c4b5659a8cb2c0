import { createCanonicalContentSearchProjection } from "@repo/search/content-search-projection";
import { PRODUCT_DISCOVERY } from "@repo/search/product-discovery";
import { describe, expect, it } from "vitest";

import { algoliaProductFieldPath } from "./connector/commercetools/generated-product";
import { contentIndexSettings } from "./content-mapping";
import { productIndexSettings } from "./index-settings";

describe("Algolia index settings", () => {
  it("configures localized Product fields without duplicating Product records", () => {
    const settings = productIndexSettings({
      currency: "USD",
      sort: "price-asc",
      storefronts: [
        { currency: "USD", locale: "en-US" },
        { currency: "CAD", locale: "fr-CA" },
      ],
    });

    expect(settings.searchableAttributes).toEqual([
      "productCard.title.en-US",
      "unordered(productCard.description.en-US)",
      "unordered(categories.label.en-US)",
      "unordered(attributeFacets.en-US)",
      "productCard.title.fr-CA",
      "unordered(productCard.description.fr-CA)",
      "unordered(categories.label.fr-CA)",
      "unordered(attributeFacets.fr-CA)",
    ]);
    expect(settings.attributesForFaceting).toEqual(
      expect.arrayContaining([
        "searchable(category.en-US)",
        "searchable(category.fr-CA)",
        "availability",
        "price.USD",
        "price.CAD",
        "filterOnly(priceAudienceIds)",
      ])
    );
    expect(settings.ranking?.[0]).toBe("asc(price.USD)");
    for (const { id, control } of PRODUCT_DISCOVERY.facets.filter(({ id }) =>
      id.startsWith("attribute.")
    )) {
      const field = `attributeFacets.fr-CA.${id.slice("attribute.".length)}`;
      expect(settings.attributesForFaceting).toContain(
        control === "range" ? field : `searchable(${field})`
      );
    }
  });

  it("derives scalar and localized Algolia paths from generated Product types", () => {
    expect(algoliaProductFieldPath("attributes.capacity")).toBe(
      "attributes.capacity"
    );
    expect(algoliaProductFieldPath("variants.attributes.model")).toBe(
      "variants.attributes.model"
    );
    expect(algoliaProductFieldPath("variants.attributes.color.en-US")).toBe(
      "variants.attributes.color.en-US"
    );

    // @ts-expect-error en-NZ is not one of the generated application locales.
    algoliaProductFieldPath("variants.attributes.color.en-NZ");
    // @ts-expect-error numeric Product attributes have no localized child path.
    algoliaProductFieldPath("variants.attributes.model.en-US");
  });

  it("keeps Content locale filtering out of returned records", () => {
    const settings = contentIndexSettings(
      createCanonicalContentSearchProjection("content"),
      ["en-US", "de-DE"]
    );

    expect(settings.attributesForFaceting).toContain("filterOnly(locales)");
    expect(settings.unretrievableAttributes).toEqual(["locales"]);
  });
});
