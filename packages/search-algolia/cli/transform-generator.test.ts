/* oxlint-disable effecttsgo/node-builtin-import -- This artifact-integrity test reads the same local source file consumed by the Node-based generator. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { ALGOLIA_COMMERCETOOLS_TRANSFORMATION_SOURCE } from "../connector/commercetools/generated-transform";
import { serializeAlgoliaCommercetoolsTransformationConfiguration } from "../connector/commercetools/transform";
import { buildAlgoliaCommercetoolsTransformationSource } from "./transform-generator";

describe(buildAlgoliaCommercetoolsTransformationSource, () => {
  it("produces standalone Algolia JavaScript from the typed transformation", async () => {
    const source = await readFile(
      path.join(process.cwd(), "connector/commercetools/transform.ts"),
      "utf-8"
    );
    const generated = buildAlgoliaCommercetoolsTransformationSource(source);
    expect(ALGOLIA_COMMERCETOOLS_TRANSFORMATION_SOURCE).toBe(generated);
    const result: unknown = await runInNewContext(
      `${ALGOLIA_COMMERCETOOLS_TRANSFORMATION_SOURCE}; transform(record, helper)`,
      {
        helper: {
          secrets: {
            get: (name: string) =>
              name === "CONFIGURATION"
                ? serializeAlgoliaCommercetoolsTransformationConfiguration({
                    priceCustomerGroupIds: ["contractors-id", "gold-id"],
                  })
                : undefined,
          },
        },
        record: {
          name: { "en-US": "Excavator" },
          objectID: "product-1",
          slug: { "en-US": "excavator" },
          variants: [
            {
              id: "variant-1",
              prices: {
                USD: {
                  min: 8000,
                  priceValues: [
                    { id: "public", value: 10_000 },
                    { id: "gold", value: 6000, customerGroupID: "gold-id" },
                    {
                      customerGroupID: "contractors-id",
                      id: "contractors",
                      value: 8000,
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      { timeout: 1000 }
    );

    expect(generated).toContain("async function transform(");
    expect(generated).not.toMatch(
      /^\s*(?:import\s|export\s|(?:interface|type|declare)\s+\w)/mu
    );
    expect(result).toMatchObject([
      {
        objectID: "product-1",
        price: { USD: 100 },
        priceAudienceIds: ["public"],
      },
      {
        objectID: "product-1--group%3Acontractors-id",
        price: { USD: 80 },
        priceAudienceIds: ["group:contractors-id"],
      },
      {
        objectID: "product-1--group%3Agold-id",
        price: { USD: 60 },
        priceAudienceIds: ["group:gold-id"],
      },
    ]);
  });
});
