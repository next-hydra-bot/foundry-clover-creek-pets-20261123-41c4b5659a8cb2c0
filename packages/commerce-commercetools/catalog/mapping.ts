import type { CategoryDraft } from "@commercetools/platform-sdk";
import type {
  ProductDraftInput,
  ProductPriceDraftInput,
  ProductVariantDraftInput,
} from "@migrate-sdk/commercetools/destination";
import type {
  Catalog,
  CatalogCategory,
  CatalogName,
  CatalogProductContent,
} from "@repo/commerce-core/catalog";
import {
  productModel,
  productTypeDefinition,
} from "@repo/commerce-core/catalog/product-model";
import { ProductAttributeEnumValue } from "@repo/commerce-core/product/attributes";
import { locales } from "@repo/i18n/config";
import { Schema } from "effect";

export const variantKey = (name: CatalogName, sku: string) =>
  `catalog-seed-${name}-${sku}`;
export const selectionKey = (name: CatalogName) => `catalog-seed-${name}`;
export const discountKey = (name: CatalogName) => `catalog-seed-${name}-prices`;

/** Native enum writes use keys; labels remain owned by the Product Type. */
export const variantAttributes = (
  variant: CatalogProductContent["variants"][number],
  productType?: string
) =>
  Object.entries(
    Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
      variant.attributes
    )
  ).map(([name, value]) => {
    const definition =
      productType === undefined
        ? productModel.productTypes
            .flatMap((type) => type.attributes)
            .find((attribute) => attribute.key === name)
        : productTypeDefinition(productType).attributes.find(
            (attribute) => attribute.key === name
          );
    const encode = (value: Schema.Json) =>
      definition?.type === "enum"
        ? Schema.decodeUnknownSync(ProductAttributeEnumValue)(value).key
        : value;
    return {
      name,
      value: definition?.list
        ? Schema.decodeUnknownSync(Schema.Array(Schema.Json))(value).map(encode)
        : encode(value),
    };
  });

export interface CatalogTarget {
  readonly distributionChannelId: string;
  readonly discountId: string;
}

export const variantPrice = (
  variant: CatalogProductContent["variants"][number],
  target: CatalogTarget
): ProductPriceDraftInput => {
  const base: ProductPriceDraftInput = {
    channel: { id: target.distributionChannelId, typeId: "channel" },
    value: variant.price.regular,
  };
  return variant.price.discounted === undefined
    ? base
    : {
        ...base,
        discounted: {
          discount: { id: target.discountId, typeId: "product-discount" },
          value: variant.price.discounted,
        },
      };
};

export const nativeImage = (
  image: CatalogProductContent["variants"][number]["images"][number]
) => {
  const base = {
    dimensions: { h: image.height, w: image.width },
    url: image.url,
  };
  return image.altText === undefined ? base : { ...base, label: image.altText };
};
const localizedText = (
  content: Pick<CatalogCategory, "title" | "description" | "translations">,
  defaultLocale: Catalog["defaultLocale"],
  field: "title" | "description"
): Record<string, string> => {
  const values = new Map<string, string>([[defaultLocale, content[field]]]);
  for (const locale of locales) {
    values.set(locale, content.translations[locale]?.[field] ?? content[field]);
  }
  for (const [locale, translation] of Object.entries(content.translations)) {
    values.set(locale, translation[field]);
  }
  return Object.fromEntries(values);
};

export const productDraft = (
  name: CatalogName,
  product: CatalogProductContent,
  target: CatalogTarget,
  defaultLocale: Catalog["defaultLocale"] = "en-US"
): ProductDraftInput => {
  const variants = product.variants.map(
    (variant): ProductVariantDraftInput => ({
      attributes: variantAttributes(variant, product.productType).filter(
        ({ name }) =>
          productTypeDefinition(product.productType).attributes.find(
            (attribute) => attribute.key === name
          )?.type !== "product-reference"
      ),
      images: variant.images.map(nativeImage),
      key: variantKey(name, variant.sku),
      prices: [variantPrice(variant, target)],
      sku: variant.sku,
    })
  );
  return {
    description: localizedText(product, defaultLocale, "description"),
    key: product.key,
    masterVariant: variants[0],
    name: localizedText(product, defaultLocale, "title"),
    productType: { key: product.productType, typeId: "product-type" },
    publish: false,
    slug: Object.fromEntries(
      locales.map((locale): [string, string] => [locale, product.key])
    ),
    variants: variants.slice(1),
  };
};

export const categoryDraft = (
  name: CatalogName,
  category: CatalogCategory,
  defaultLocale: Catalog["defaultLocale"]
): CategoryDraft => ({
  description: localizedText(category, defaultLocale, "description"),
  externalId: `catalog-seed:${name}:${category.key}`,
  key: category.key,
  name: localizedText(category, defaultLocale, "title"),
  slug: Object.fromEntries(
    locales.map((locale): [string, string] => [locale, category.key])
  ),
});
