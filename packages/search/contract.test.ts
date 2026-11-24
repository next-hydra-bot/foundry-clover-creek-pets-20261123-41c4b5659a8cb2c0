import { describe, expect, it } from "vitest";

import { searchFacetLabels } from "./contract";

describe(searchFacetLabels, () => {
  it("reads stable values and translated labels independently of hits", () => {
    expect(
      searchFacetLabels([
        { banner: "Other rule metadata" },
        { facetLabels: { category: { "outdoor-packs": "Sacs de randonnée" } } },
        { facetLabels: { category: { bottles: "Gourdes" } } },
      ])
    ).toEqual({
      category: { "outdoor-packs": "Sacs de randonnée", bottles: "Gourdes" },
    });
  });

  it("ignores missing or malformed label metadata", () => {
    expect(searchFacetLabels(undefined)).toEqual({});
    expect(
      searchFacetLabels([{ facetLabels: { category: { broken: 12 } } }])
    ).toEqual({});
  });
});
