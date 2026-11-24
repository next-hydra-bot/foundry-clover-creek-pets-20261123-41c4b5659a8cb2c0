// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { decodeProductModel } from "@repo/commerce-core/catalog/product-model";

import { productTypeDrafts } from "./schema";

describe("native custom product models", () => {
  it("maps a custom domain model to native typed and localized attributes", () => {
    const model = decodeProductModel({
      defaultLocale: "en-US",
      productTypes: [
        {
          attributes: [
            {
              key: "roast",
              type: "enum",
              required: true,
              labels: { "en-US": "Roast" },
              values: [
                {
                  key: "dark-roast",
                  labels: { "en-US": "Dark", "fr-FR": "Foncé" },
                },
              ],
            },
            {
              key: "notes",
              type: "text",
              list: true,
              required: false,
              labels: { "en-US": "Notes" },
            },
          ],
          description: "Beans",
          key: "coffee",
          labels: { "en-US": "Coffee" },
          variantOptions: ["roast"],
        },
      ],
      schemaVersion: 1,
    });
    const [type] = productTypeDrafts(model);
    expect(type?.key).toBe("coffee");
    expect(type?.attributes[0]?.type).toMatchObject({
      name: "lenum",
      values: [{ key: "dark-roast", label: { "fr-FR": "Foncé" } }],
    });
    expect(type?.attributes[1]?.type).toEqual({
      elementType: { name: "text" },
      name: "set",
    });
  });
});
