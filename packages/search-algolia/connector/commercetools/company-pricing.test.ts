import { describe, expect, it } from "vitest";

import type { AlgoliaCommercetoolsRawProduct } from "./generated-product";
import {
  serializeAlgoliaCommercetoolsTransformationConfiguration,
  transform,
} from "./transform";

const configuration = {
  priceCustomerGroupIds: ["trade-customers", "gold-id", "standard-id"],
  publicPriceChannelIds: ["retail-channel"],
};
const helper = (config = configuration) => ({
  secrets: {
    get: () => serializeAlgoliaCommercetoolsTransformationConfiguration(config),
  },
});
const product = {
  name: { "en-US": "Machine" },
  objectID: "machine",
  slug: { "en-US": "machine" },
  variants: [
    {
      id: "variant-1",
      isInStock: true,
      prices: {
        USD: {
          min: 500,
          priceValues: [
            { id: "retail-1", value: 10_000, channelID: "retail-channel" },
            {
              id: "trade-1",
              value: 9000,
              channelID: "retail-channel",
              customerGroupID: "trade-customers",
            },
            {
              id: "gold-1",
              value: 6000,
              channelID: "retail-channel",
              customerGroupID: "gold-id",
            },
            {
              id: "standard-1",
              value: 7000,
              channelID: "retail-channel",
              customerGroupID: "standard-id",
            },
            {
              id: "foreign-private-1",
              value: 500,
              channelID: "another-company-channel",
            },
          ],
        },
      },
    },
    {
      id: "variant-2",
      isInStock: false,
      prices: {
        USD: {
          min: 6500,
          priceValues: [
            { id: "retail-2", value: 8000, channelID: "retail-channel" },
            {
              id: "trade-2",
              value: 7500,
              channelID: "retail-channel",
              customerGroupID: "trade-customers",
            },
            {
              id: "gold-2",
              value: 6500,
              channelID: "retail-channel",
              customerGroupID: "gold-id",
            },
            {
              id: "standard-2",
              value: 7200,
              channelID: "retail-channel",
              customerGroupID: "standard-id",
            },
          ],
        },
      },
    },
  ],
} satisfies AlgoliaCommercetoolsRawProduct;

describe("commercetools search pricing audiences", () => {
  it("fans out native Customer Groups for consumer and company pricing without mixing Store channels", async () => {
    const records = await transform(product, helper());
    expect(records).toHaveLength(4);
    expect(
      records.map((record) => ({
        audience: record.priceAudienceIds,
        id: record.objectID,
        price: record.price?.USD,
      }))
    ).toEqual([
      { audience: ["public"], id: "machine", price: 80 },
      {
        audience: ["group:trade-customers"],
        id: "machine--group%3Atrade-customers",
        price: 75,
      },
      {
        audience: ["group:gold-id"],
        id: "machine--group%3Agold-id",
        price: 60,
      },
      {
        audience: ["group:standard-id"],
        id: "machine--group%3Astandard-id",
        price: 70,
      },
    ]);
    expect(records[2]?.productCard.startingPrice?.USD).toEqual({
      centAmount: 6000,
      currencyCode: "USD",
    });
    expect(JSON.stringify(records)).not.toMatch(
      /channelID|customerGroupID|priceValues/u
    );
  });

  it("keeps equal-price groups separate with stable IDs when prices or configuration order change", async () => {
    const first = await transform(product, helper());
    const reversedGroups = [...configuration.priceCustomerGroupIds];
    // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 target; reverse a fresh local copy.
    reversedGroups.reverse();
    const changed = await transform(
      {
        ...product,
        variants: product.variants.map((variant) => ({
          ...variant,
          prices: {
            USD: {
              ...variant.prices.USD,
              priceValues: variant.prices.USD.priceValues.map((price) =>
                price.customerGroupID === "gold-id"
                  ? { ...price, value: 7000 }
                  : price
              ),
            },
          },
        })),
      },
      helper({
        ...configuration,
        priceCustomerGroupIds: reversedGroups,
      })
    );
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sort a fresh local array.
    expect(changed.map((row) => row.objectID).sort()).toEqual(
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sort a fresh local array.
      first.map((row) => row.objectID).sort()
    );
    expect(changed.filter((row) => row.price?.USD === 70)).toHaveLength(2);
  });

  it("uses native public fallback when the selected Customer Group has no price", async () => {
    const incomplete = {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        prices: {
          USD: {
            ...variant.prices.USD,
            priceValues: variant.prices.USD.priceValues.filter(
              (price) => price.customerGroupID !== "gold-id"
            ),
          },
        },
      })),
    };
    const records = await transform(incomplete, helper());
    expect(
      records.find((record) =>
        record.priceAudienceIds.includes("group:gold-id")
      )?.price?.USD
    ).toBe(80);
  });

  it("does not use prices outside the Store channel projection", async () => {
    const records = await transform(
      product,
      helper({ ...configuration, publicPriceChannelIds: [] })
    );
    expect(
      records.find((record) => record.priceAudienceIds.includes("public"))
        ?.price
    ).toBeUndefined();
    expect(
      records.find((record) =>
        record.priceAudienceIds.includes("group:gold-id")
      )?.price?.USD
    ).toBeUndefined();
  });

  it("rejects duplicate native group IDs", async () => {
    await expect(
      transform(
        product,
        helper({
          ...configuration,
          priceCustomerGroupIds: [
            ...configuration.priceCustomerGroupIds,
            ...configuration.priceCustomerGroupIds,
          ],
        })
      )
    ).rejects.toThrow("Ambiguous");
  });
});
