/* oxlint-disable vitest/no-standalone-expect -- Assertions run inside it.effect.each, which this rule does not recognize. */

import { describe, expect, it } from "@effect/vitest";
import { loadCatalog } from "@repo/commerce-core/catalog/files";
import { Money } from "@repo/commerce-core/domain/money";
import { CommerceLocale } from "@repo/commerce-core/store";
import { Effect, Schema } from "effect";

import type {
  CommercetoolsProductProjection,
  CommercetoolsProductVariant,
} from "../product/client";
import { mapProductCard, mapProductDetail } from "../product/mapping";
import { categoryDraft, productDraft } from "./mapping";
import { productTypes } from "./schema";

const target = { discountId: "discount-1", distributionChannelId: "channel-1" };

describe("Commercetools domain catalog mapping", () => {
  it.effect.each(["b2b", "b2c"] as const)(
    "round-trips the shared %s JSON through native writes and the storefront reader",
    (group) =>
      Effect.gen(function* () {
        for (const source of loadCatalog(group).products) {
          const draft = productDraft(group, source, target);
          const variants = [draft.masterVariant, ...(draft.variants ?? [])].map(
            (variant, index): CommercetoolsProductVariant => {
              if (variant === undefined) {
                throw new Error("Missing master variant");
              }
              const price = variant.prices?.[0];
              if (price === undefined) {
                throw new Error("Missing catalog price");
              }
              return {
                attributesRaw: (variant.attributes ?? []).map(
                  ({ name, value }) => {
                    const rawValue = Schema.decodeUnknownSync(Schema.Json)(
                      value
                    );
                    const type = productTypes
                      .find(({ key }) => key === source.productType)
                      ?.attributes.find(
                        (attribute) => attribute.name === name
                      )?.type;
                    if (type?.name === "enum" || type?.name === "lenum") {
                      const native = type.values.find(
                        ({ key }) => key === rawValue
                      );
                      if (native === undefined) {
                        throw new Error(`Invalid native enum ${name}`);
                      }
                      return { name, value: native };
                    }
                    return { name, value: rawValue };
                  }
                ),
                availability: {
                  channels: [
                    {
                      availableQuantity: source.variants[index]?.quantity ?? 0,
                    },
                  ],
                },
                id: index + 1,
                images: (variant.images ?? []).map(({ url, label }) => ({
                  label: label ?? null,
                  url,
                })),
                price: {
                  discounted:
                    price.discounted === undefined
                      ? null
                      : {
                          value: Schema.decodeUnknownSync(Money)(
                            price.discounted.value
                          ),
                        },
                  value: Schema.decodeUnknownSync(Money)(price.value),
                },
                sku: variant.sku ?? null,
              };
            }
          );
          const projection: CommercetoolsProductProjection = {
            allVariants: variants,
            categories: source.categoryKeys.map((key) => {
              const category = loadCatalog(group).categories.find(
                (item) => item.key === key
              );
              return { id: key, name: category?.title ?? null, slug: key };
            }),
            description: draft.description?.["en-US"] ?? null,
            id: source.key,
            masterVariant: { images: variants[0]?.images ?? [] },
            name: draft.name["en-US"] ?? null,
            productType: { key: draft.productType.key ?? null },
            slug: draft.slug["en-US"] ?? null,
          };
          const result = yield* mapProductDetail(
            projection,
            variants,
            CommerceLocale.make("en-US")
          );
          const frenchCategories = source.categoryKeys.map((key) => {
            const category = loadCatalog(group).categories.find(
              (item) => item.key === key
            );
            return {
              id: key,
              name: category?.translations["fr-FR"]?.title ?? null,
              slug: key,
            };
          });
          const translated = yield* mapProductDetail(
            {
              ...projection,
              categories: frenchCategories,
              description: draft.description?.["fr-FR"] ?? null,
              name: draft.name["fr-FR"] ?? null,
            },
            variants,
            CommerceLocale.make("fr-FR")
          );
          expect({
            categories: translated.categories.map(({ name }) => name),
            description: translated.description,
            title: translated.title,
          }).toEqual({
            ...source.translations["fr-FR"],
            categories: frenchCategories.map(({ name }) => name),
          });
          expect(result.options).toMatchObject(source.options);
          expect(result.categories.map(({ id }) => id)).toEqual(
            source.categoryKeys
          );
          const card = yield* mapProductCard(projection, variants);
          expect(card.startingPrice).toEqual({
            centAmount: Math.min(
              ...source.variants.map(
                ({ price }) => (price.discounted ?? price.regular).centAmount
              )
            ),
            currencyCode: "USD",
          });
          expect(
            result.variants.map(
              ({
                sku,
                attributes,
                optionValues,
                price,
                availability,
                images,
              }) => ({
                attributes,
                images,
                optionValues,
                price,
                quantity: availability.availableQuantity,
                sku,
              })
            )
          ).toEqual(
            source.variants.map(({ images, ...variant }) => ({
              ...variant,
              images: images.map(({ url, altText }) =>
                altText === undefined ? { url } : { altText, url }
              ),
            }))
          );
        }
      })
  );

  it("maps product and category translations into native localized fields", () => {
    const catalog = loadCatalog("b2c");
    const [product] = catalog.products;
    const [category] = catalog.categories;
    if (category === undefined) {
      throw new Error("Missing category fixture");
    }
    const draft = productDraft("b2c", product, target, catalog.defaultLocale);
    const categoryInput = categoryDraft("b2c", category, catalog.defaultLocale);
    expect(draft.name["fr-FR"]).toBe(product.translations["fr-FR"]?.title);
    expect(draft.description?.["fr-FR"]).toBe(
      product.translations["fr-FR"]?.description
    );
    expect(categoryInput.name["fr-FR"]).toBe(
      category.translations["fr-FR"]?.title
    );
    expect(draft.masterVariant?.images?.[0]?.dimensions).toEqual({
      h: product.variants[0]?.images[0]?.height,
      w: product.variants[0]?.images[0]?.width,
    });
  });

  it("encodes enum keys and exact minor-unit prices without Shopify fields", () => {
    const [source] = loadCatalog("b2c").products;
    const draft = productDraft("b2c", source, target);
    expect(draft.masterVariant?.attributes).toContainEqual({
      name: "color",
      value: "RED",
    });
    expect(draft.masterVariant?.prices?.[0]).toMatchObject({
      discounted: { value: { centAmount: 8900, currencyCode: "USD" } },
      value: { centAmount: 11_000, currencyCode: "USD" },
    });
    expect(() => Schema.decodeUnknownSync(Schema.Json)(draft)).not.toThrow();
  });
});
