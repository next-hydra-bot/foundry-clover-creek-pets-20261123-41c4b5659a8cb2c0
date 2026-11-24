import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/ts-client";
import { expect, layer } from "@effect/vitest";
import { CatalogTaxSetup } from "@repo/commerce-core/catalog/tax";
import { Effect, Schema } from "effect";

import { testTracking } from "../catalog/tracking.test-fixture";
import {
  applyTaxSetup,
  CommercetoolsTaxConfig,
  validateTaxConfig,
} from "./tax";

const setup = Schema.decodeUnknownSync(CatalogTaxSetup)({
  classes: [{ key: "goods", name: "Goods" }],
  products: [{ productKey: "bottle", taxClassKey: "goods" }],
});
const rate = {
  amount: 0.1,
  country: "US",
  includedInPrice: false,
  key: "us-ny",
  name: "Demo rate",
  state: "NY",
};
const config = Schema.decodeUnknownSync(CommercetoolsTaxConfig)({
  classes: [
    { taxClassKey: "goods", taxCategoryKey: "goods-tax", rates: [rate] },
  ],
  countryTaxRateFallbackEnabled: false,
  shippingMethods: [
    { shippingMethodKey: "standard-shipping", taxClassKey: "goods" },
  ],
});

const products = new Map([["bottle", "product-1"]]);

const fixture = (responses: readonly Schema.Json[]) => {
  const requests: {
    method: string;
    path: string;
    body: Schema.Json | undefined;
  }[] = [];
  const pending = [...responses];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      body:
        request.method === "GET"
          ? undefined
          : Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
              await request.text()
            ),
      method: request.method,
      path: new URL(request.url).pathname,
    });
    if (!pending.length) {
      throw new Error("Unexpected tax request");
    }
    return Response.json(pending.shift());
  };
  const sdk = new ClientBuilder()
    .withHttpMiddleware({
      enableRetry: false,
      host: "https://api.example.test",
      httpClient: fetcher,
    })
    .build();
  const client = Effect.succeed(
    createApiBuilderFromCtpClient(sdk).withProjectKey({
      projectKey: "fixtures",
    })
  );
  return { client, requests };
};

layer(testTracking)("Commercetools tax provisioning", (it) => {
  it.effect(
    "validates jurisdictions and reference mappings, including zero rates",
    () =>
      Effect.sync(() => {
        expect(() => {
          validateTaxConfig(setup, config);
        }).not.toThrow();
        expect(() =>
          Schema.decodeUnknownSync(CommercetoolsTaxConfig)({
            ...config,
            classes: [
              { ...config.classes[0], rates: [{ ...rate, amount: 0 }] },
            ],
          })
        ).not.toThrow();
        expect(() => {
          validateTaxConfig(setup, {
            ...config,
            classes: [
              {
                ...config.classes[0],
                rates: [rate, { ...rate, key: "another" }],
              },
            ],
          });
        }).toThrow("country/state");
        expect(() => {
          validateTaxConfig(setup, {
            ...config,
            shippingMethods: [
              { shippingMethodKey: "shipping", taxClassKey: "unknown" },
            ],
          });
        }).toThrow("Shipping Method");
      })
  );
  it.effect(
    "creates native rates, assigns products and shipping, and changes fallback only explicitly",
    () =>
      Effect.gen(function* () {
        const { client, requests } = fixture([
          { results: [] },
          { id: "tax-1", version: 1 },
          { carts: { countryTaxRateFallbackEnabled: true }, version: 4 },
          { key: "fixtures", version: 5 },
          { id: "product-1", version: 2 },
          { id: "product-1", version: 3 },
          { id: "shipping-1", taxCategory: { id: "old-tax" }, version: 3 },
          { id: "shipping-1", version: 4 },
        ]);
        yield* applyTaxSetup(client, setup, config, products);
        const writes = requests.filter(({ method }) => method === "POST");
        expect(writes.map(({ path }) => path)).toEqual([
          "/fixtures/tax-categories",
          "/fixtures",
          "/fixtures/products/product-1",
          "/fixtures/shipping-methods/shipping-1",
        ]);
        expect(writes[0]?.body).toMatchObject({
          key: "goods-tax",
          rates: [rate],
        });
        expect(writes[1]?.body).toEqual({
          actions: [
            {
              action: "changeCountryTaxRateFallbackEnabled",
              countryTaxRateFallbackEnabled: false,
            },
          ],
          version: 4,
        });
        expect(writes[2]?.body).toEqual({
          actions: [
            {
              action: "setTaxCategory",
              taxCategory: { id: "tax-1", typeId: "tax-category" },
            },
          ],
          version: 2,
        });
        expect(writes[3]?.body).toEqual({
          actions: [
            {
              action: "changeTaxCategory",
              taxCategory: { id: "tax-1", typeId: "tax-category" },
            },
          ],
          version: 3,
        });
      })
  );
  it.effect("does not write unchanged resources on retry", () =>
    Effect.gen(function* () {
      const { client, requests } = fixture([
        {
          results: [
            {
              id: "tax-1",
              name: "Goods",
              rates: [{ id: "rate-1", ...rate }],
              version: 1,
            },
          ],
        },
        { carts: { countryTaxRateFallbackEnabled: false }, version: 4 },
        { id: "product-1", taxCategory: { id: "tax-1" }, version: 2 },
        { id: "shipping-1", taxCategory: { id: "tax-1" }, version: 3 },
      ]);
      yield* applyTaxSetup(client, setup, config, products);
      expect(requests.every(({ method }) => method === "GET")).toBeTruthy();
    })
  );
  it.effect(
    "updates keyed rates with the current version and preserves other jurisdictions",
    () =>
      Effect.gen(function* () {
        const { client, requests } = fixture([
          {
            results: [
              {
                id: "tax-1",
                name: "Goods",
                rates: [
                  { id: "rate-1", ...rate, amount: 0 },
                  {
                    id: "other-rate",
                    key: "other",
                    country: "DE",
                    name: "Other",
                    amount: 0.2,
                    includedInPrice: true,
                  },
                ],
                version: 8,
              },
            ],
          },
          { id: "tax-1", version: 9 },
          { id: "product-1", taxCategory: { id: "tax-1" }, version: 2 },
        ]);
        const { countryTaxRateFallbackEnabled: _, ...withoutFallback } = config;
        yield* applyTaxSetup(
          client,
          setup,
          {
            ...withoutFallback,
            shippingMethods: [],
          },
          products
        );
        expect(requests.find(({ method }) => method === "POST")?.body).toEqual({
          actions: [
            { action: "replaceTaxRate", taxRateKey: rate.key, taxRate: rate },
          ],
          version: 8,
        });
        expect(requests.some(({ path }) => path === "/fixtures")).toBeFalsy();
      })
  );
  it.effect(
    "fails rather than adopting another rate for the same jurisdiction",
    () =>
      Effect.gen(function* () {
        const { client, requests } = fixture([
          {
            results: [
              {
                id: "tax-1",
                name: "Goods",
                rates: [{ ...rate, key: "foreign-rate" }],
                version: 1,
              },
            ],
          },
        ]);
        const failure = yield* applyTaxSetup(
          client,
          setup,
          config,
          products
        ).pipe(Effect.flip);
        expect(failure.message).toContain("differently keyed rate");
        expect(requests).toHaveLength(1);
      })
  );
});
