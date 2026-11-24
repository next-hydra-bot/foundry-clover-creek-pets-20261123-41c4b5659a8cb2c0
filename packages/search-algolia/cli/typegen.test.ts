import { describe, expect, it } from "vitest";

import { buildAlgoliaCommercetoolsProductSource } from "./typegen";

describe(buildAlgoliaCommercetoolsProductSource, () => {
  it("derives typed connector fields and locale-specific facets from explicit Product Type schemas", () => {
    const source = buildAlgoliaCommercetoolsProductSource(
      [
        {
          key: "equipment",
          attributes: [
            {
              name: "capacity",
              type: { name: "number" },
              attributeConstraint: "SameForAll",
            },
            { name: "model", type: { name: "number" } },
            { name: "color", type: { name: "lenum" } },
          ],
        },
      ],
      ["en-US", "fr-FR"],
      ["USD", "EUR"]
    );
    expect(source).toContain('readonly "capacity"?: number;');
    expect(source).toContain('readonly "model"?: number;');
    expect(source).toContain(
      'readonly "color"?: AlgoliaCommercetoolsEnumValue | LocalizedStringByAlgoliaConnectorLocale | string;'
    );
    expect(source).toContain("readonly attributeFacets: Partial<");
    expect(source).toContain(
      "export type AlgoliaProductFieldPath = FieldPath<AlgoliaProductRecord>;"
    );
  });
});
