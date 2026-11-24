import { decodeProductModel } from "@repo/commerce-core/catalog/product-model";
import { describe, expect, it } from "vitest";

import { productSearchFacets } from "./product-attribute-discovery";

const voltage = {
  key: "voltage",
  labels: { "en-US": "Voltage" },
  required: false,
  type: "integer",
};
const finish = {
  key: "finish",
  labels: { "en-US": "Finish" },
  required: false,
  type: "enum",
  values: [{ key: "matte", labels: { "en-US": "Matte" } }],
};
const model = (searchFacets?: readonly string[]) =>
  decodeProductModel({
    defaultLocale: "en-US",
    productTypes: [
      {
        attributes: [voltage, finish],
        description: "",
        key: "power-tool",
        labels: { "en-US": "Power tool" },
        searchFacets,
        variantOptions: ["finish"],
      },
    ],
    schemaVersion: 1,
  });

describe("Product Model search facets", () => {
  it("derives ordered facets and controls from custom attribute keys", () => {
    expect(productSearchFacets(model(["finish", "voltage"]))).toMatchObject([
      {
        attribute: { key: "finish", labels: { "en-US": "Finish" } },
        control: "refinement-list",
        id: "attribute.finish",
        route: "attribute.finish",
      },
      {
        attribute: { key: "voltage", labels: { "en-US": "Voltage" } },
        control: "range",
        id: "attribute.voltage",
        route: "attribute.voltage",
      },
    ]);
  });

  it("allows a Product Type to omit or explicitly disable attribute facets", () => {
    expect(productSearchFacets(model())).toEqual([]);
    expect(productSearchFacets(model([]))).toEqual([]);
  });

  it("combines Product Types in model order and merges shared facet labels", () => {
    const first = model(["finish", "voltage"]);
    const combined = decodeProductModel({
      ...first,
      productTypes: [
        ...first.productTypes,
        {
          attributes: [
            { ...voltage, labels: { "en-US": "Voltage", "fr-FR": "Tension" } },
            {
              key: "certified",
              labels: { "en-US": "Certified" },
              required: false,
              type: "boolean",
            },
          ],
          description: "",
          key: "accessory",
          labels: { "en-US": "Accessory" },
          searchFacets: ["voltage", "certified"],
          variantOptions: [],
        },
      ],
    });
    const facets = productSearchFacets(combined);
    expect(facets.map(({ id }) => id)).toEqual([
      "attribute.finish",
      "attribute.voltage",
      "attribute.certified",
    ]);
    expect(facets[1]?.attribute.labels["fr-FR"]).toBe("Tension");
  });
});
