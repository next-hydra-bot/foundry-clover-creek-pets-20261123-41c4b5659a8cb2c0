/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, eslint/require-await -- Algolia executes this generated transformation without imports, requires an async transform entry point, and supplies untyped connector records and JSON configuration. */

import type { ProductAttributeDefinition } from "@repo/commerce-core/catalog/product-model";

import type {
  AlgoliaCommercetoolsRawPriceValue,
  AlgoliaCommercetoolsRawProduct,
  AlgoliaCommercetoolsRawVariant,
  AlgoliaConnectorCurrency,
  AlgoliaConnectorLocale,
  AlgoliaProductCategory,
  AlgoliaProductMoney,
  AlgoliaProductRecord,
} from "./generated-product";
import {
  ALGOLIA_CONNECTOR_CURRENCIES,
  ALGOLIA_CONNECTOR_LOCALES,
} from "./generated-product";

export interface AlgoliaCommercetoolsTransformationConfiguration {
  readonly attributeFacets?: readonly AlgoliaCommercetoolsAttributeFacet[];
  readonly defaultLocale?: string;
  readonly priceCustomerGroupIds: readonly string[];
  /** Only these Store channels can contribute to public/native Customer Group prices. */
  readonly publicPriceChannelIds?: readonly string[];
}

export interface AlgoliaCommercetoolsAttributeFacet {
  readonly key: string;
  readonly type: ProductAttributeDefinition["type"];
  readonly list: boolean;
  readonly enumKeys: readonly string[];
}

interface AlgoliaTransformationHelper {
  readonly secrets?: {
    readonly get?: (name: string) => string | undefined;
  };
}

export const ALGOLIA_COMMERCETOOLS_CONFIGURATION_SECRET_NAME = "CONFIGURATION";

const ALGOLIA_COMMERCETOOLS_CONFIGURATION_VERSION = 7;

export const serializeAlgoliaCommercetoolsTransformationConfiguration = (
  configuration: AlgoliaCommercetoolsTransformationConfiguration
): string =>
  JSON.stringify({
    version: ALGOLIA_COMMERCETOOLS_CONFIGURATION_VERSION,
    ...configuration,
    attributeFacets: configuration.attributeFacets ?? [],
    defaultLocale: configuration.defaultLocale ?? ALGOLIA_CONNECTOR_LOCALES[0],
    publicPriceChannelIds: configuration.publicPriceChannelIds ?? [],
  });

interface PriceCandidate {
  centAmount: number;
  regularCentAmount?: number;
  customerGroupID?: string;
  channelID?: string;
}

interface PriceSlice {
  readonly audienceIds: string[];
  readonly price: Partial<Record<AlgoliaConnectorCurrency, number>>;
  readonly regularStartingPrice: Partial<
    Record<AlgoliaConnectorCurrency, AlgoliaProductMoney>
  >;
  readonly startingPrice: Partial<
    Record<AlgoliaConnectorCurrency, AlgoliaProductMoney>
  >;
}

interface LocalizedProductCategories {
  readonly categories: readonly AlgoliaProductCategory[];
  readonly category: Partial<Record<AlgoliaConnectorLocale, readonly string[]>>;
}

const publicAudience = "public";

const isConfiguredObject = (
  value: unknown
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type AttributeFacetValue = boolean | number | string;

const attributeScalar = (
  value: unknown,
  attribute: AlgoliaCommercetoolsAttributeFacet,
  locale: string,
  defaultLocale: string
): AttributeFacetValue | undefined => {
  switch (attribute.type) {
    case "integer":
    case "number": {
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (attribute.type !== "integer" || Number.isSafeInteger(value))
      ) {
        return value;
      }
      break;
    }
    case "boolean": {
      if (typeof value === "boolean") {
        return value;
      }
      break;
    }
    case "text": {
      const text = isConfiguredObject(value)
        ? (value[locale] ?? value[defaultLocale])
        : value;
      if (text === undefined || typeof text === "string") {
        return text;
      }
      break;
    }
    case "enum": {
      const key = isConfiguredObject(value) ? value.key : value;
      if (typeof key === "string" && attribute.enumKeys.includes(key)) {
        return key;
      }
      break;
    }
    case "product-reference": {
      const id = isConfiguredObject(value)
        ? value.typeId === "product" && value.id
        : value;
      if (typeof id === "string" && id.length > 0) {
        return id;
      }
      break;
    }
    default: {
      throw new Error("Unsupported commercetools facet type");
    }
  }
  throw new Error(`Invalid commercetools attribute facet ${attribute.key}`);
};

const productAttributeValues = (
  record: AlgoliaCommercetoolsRawProduct,
  configuration: AlgoliaCommercetoolsTransformationConfiguration
): AlgoliaProductRecord["attributeFacets"] => {
  const variants =
    record.variants.length === 0
      ? [{ attributes: undefined }]
      : record.variants;
  return Object.fromEntries(
    ALGOLIA_CONNECTOR_LOCALES.map((locale) => {
      const facets = new Map<string, Set<AttributeFacetValue>>();
      for (const variant of variants) {
        const fields = new Map<string, unknown>(
          Object.entries({ ...record.attributes, ...variant.attributes })
        );
        for (const attribute of configuration.attributeFacets ?? []) {
          const raw = fields.get(attribute.key);
          if (raw === undefined || raw === null) {
            continue;
          }
          if (attribute.list && !Array.isArray(raw)) {
            throw new Error(`Expected a list for ${attribute.key}`);
          }
          const values = attribute.list && Array.isArray(raw) ? raw : [raw];
          const selected =
            facets.get(attribute.key) ?? new Set<AttributeFacetValue>();
          for (const value of values) {
            const scalar = attributeScalar(
              value,
              attribute,
              locale,
              configuration.defaultLocale ?? ALGOLIA_CONNECTOR_LOCALES[0]
            );
            if (scalar !== undefined) {
              selected.add(scalar);
            }
          }
          if (selected.size > 0) {
            facets.set(attribute.key, selected);
          }
        }
      }
      return [
        locale,
        Object.fromEntries(
          [...facets].map(([key, values]) => [key, [...values]])
        ),
      ] as const;
    })
  );
};

const image = (variants: readonly AlgoliaCommercetoolsRawVariant[]) => {
  for (const variant of variants) {
    const [candidate] = variant.images ?? [];
    if (candidate !== undefined) {
      if (typeof candidate === "string") {
        return { url: candidate };
      }
      const { url } = candidate;
      return candidate.label === undefined
        ? { url }
        : { altText: candidate.label, url };
    }
  }
  return undefined;
};

const isAvailable = (variants: readonly AlgoliaCommercetoolsRawVariant[]) =>
  variants.some((variant) => variant.isInStock === true);

const priceCandidates = (
  variant: AlgoliaCommercetoolsRawVariant,
  currency: AlgoliaConnectorCurrency
): PriceCandidate[] =>
  (variant.prices?.[currency]?.priceValues ?? []).map(
    (price: AlgoliaCommercetoolsRawPriceValue) => {
      const candidate: PriceCandidate = {
        centAmount: price.discountedValue ?? price.value,
        regularCentAmount: price.value,
      };
      if (price.channelID !== undefined) {
        candidate.channelID = price.channelID;
      }
      if (price.customerGroupID !== undefined) {
        candidate.customerGroupID = price.customerGroupID;
      }
      return candidate;
    }
  );

const lowestPrice = (
  candidates: readonly PriceCandidate[]
): PriceCandidate | undefined => {
  let lowest: PriceCandidate | undefined;
  for (const candidate of candidates) {
    if (
      !Number.isSafeInteger(candidate.centAmount) ||
      candidate.centAmount < 0
    ) {
      throw new Error("Invalid commercetools search price amount");
    }
    if (
      lowest === undefined ||
      candidate.centAmount < lowest.centAmount ||
      (candidate.centAmount === lowest.centAmount &&
        (candidate.regularCentAmount ?? candidate.centAmount) <
          (lowest.regularCentAmount ?? lowest.centAmount))
    ) {
      lowest = candidate;
    }
  }
  return lowest;
};

const priceForAudience = (
  candidates: readonly PriceCandidate[],
  audienceID: string | undefined,
  publicPriceChannelIds: readonly string[]
): PriceCandidate | undefined => {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.channelID === undefined ||
      publicPriceChannelIds.includes(candidate.channelID)
  );
  const audiencePrices = eligible.filter(
    ({ customerGroupID }) => customerGroupID === audienceID
  );
  const fallbackPrices = eligible.filter(
    ({ customerGroupID }) => customerGroupID === undefined
  );
  // Native Customer Group specificity precedes channel specificity.
  const grouped = audiencePrices.length > 0 ? audiencePrices : fallbackPrices;
  const channelPrices = grouped.filter(
    (candidate) => candidate.channelID !== undefined
  );
  return lowestPrice(channelPrices.length > 0 ? channelPrices : grouped);
};

const categoriesFromRecord = (
  record: AlgoliaCommercetoolsRawProduct
): LocalizedProductCategories => {
  const categories = new Map<string, AlgoliaProductCategory>();
  const category: Partial<Record<AlgoliaConnectorLocale, readonly string[]>> =
    {};
  for (const locale of ALGOLIA_CONNECTOR_LOCALES) {
    const keys = record.categoryKeys?.[locale] ?? [];
    category[locale] = keys;
    const labels = Object.values(record.categories?.[locale] ?? {}).flatMap(
      (paths) => paths.map((path) => path.split(" > ").at(-1) ?? path)
    );
    for (const [index, key] of keys.entries()) {
      const existing = categories.get(key) ?? { key, label: {} };
      existing.label[locale] = labels[index] ?? key;
      categories.set(key, existing);
    }
  }
  return { categories: [...categories.values()], category };
};

const priceSlices = (
  variants: readonly AlgoliaCommercetoolsRawVariant[],
  currencies: readonly AlgoliaConnectorCurrency[],
  configuration: AlgoliaCommercetoolsTransformationConfiguration
): PriceSlice[] => {
  const audiences = [
    { customerGroupId: undefined, id: publicAudience },
    ...configuration.priceCustomerGroupIds.map((id) => ({
      customerGroupId: id,
      id: `group:${id}`,
    })),
  ];
  return audiences.map((audience) => {
    const price: Partial<Record<AlgoliaConnectorCurrency, number>> = {};
    const startingPrice: Partial<
      Record<AlgoliaConnectorCurrency, AlgoliaProductMoney>
    > = {};
    const regularStartingPrice: PriceSlice["regularStartingPrice"] = {};
    for (const currency of currencies) {
      const candidates: PriceCandidate[] = [];
      for (const variant of variants) {
        const amount = priceForAudience(
          priceCandidates(variant, currency),
          audience.customerGroupId,
          configuration.publicPriceChannelIds ?? []
        );
        if (amount !== undefined) {
          candidates.push(amount);
        }
      }
      const selected = lowestPrice(candidates);
      const centAmount = selected?.centAmount;
      if (centAmount !== undefined) {
        const digits =
          new Intl.NumberFormat("en", {
            currency,
            style: "currency",
          }).resolvedOptions().maximumFractionDigits ?? 2;
        price[currency] = centAmount / 10 ** digits;
        startingPrice[currency] = { centAmount, currencyCode: currency };
        if (
          selected?.regularCentAmount !== undefined &&
          selected.regularCentAmount > centAmount
        ) {
          regularStartingPrice[currency] = {
            centAmount: selected.regularCentAmount,
            currencyCode: currency,
          };
        }
      }
    }
    return {
      audienceIds: [audience.id],
      price,
      regularStartingPrice,
      startingPrice,
    };
  });
};

const transformProduct = (
  record: AlgoliaCommercetoolsRawProduct,
  configuration: AlgoliaCommercetoolsTransformationConfiguration
): AlgoliaProductRecord[] => {
  const availableForSale = isAvailable(record.variants);
  const availability: AlgoliaProductRecord["availability"] = availableForSale
    ? "in-stock"
    : "out-of-stock";
  const featuredImage = image(record.variants);
  const description = record.description ?? {};
  const title = record.name ?? {};
  const slug = record.slug ?? {};
  const { categories, category } = categoriesFromRecord(record);
  const attributeFacets = productAttributeValues(record, configuration);
  const currencies = ALGOLIA_CONNECTOR_CURRENCIES.filter((currency) =>
    record.variants.some((variant) => variant.prices?.[currency] !== undefined)
  );
  const variants = record.variants.map(({ attributes, id, key, sku }) => {
    const variantCore = { id };
    const variantWithAttributes =
      attributes === undefined ? variantCore : { ...variantCore, attributes };
    const variantWithKey =
      key === undefined
        ? variantWithAttributes
        : { ...variantWithAttributes, key };
    return sku === undefined ? variantWithKey : { ...variantWithKey, sku };
  });

  return priceSlices(record.variants, currencies, configuration).map(
    ({ audienceIds, price, startingPrice, regularStartingPrice }) => {
      const objectID = audienceIds.includes(publicAudience)
        ? record.objectID
        : `${record.objectID}--${encodeURIComponent(audienceIds[0] ?? publicAudience)}`;
      const productCardCore = {
        availableForSale,
        id: record.objectID,
        slug,
        title,
      };
      const productCardWithDescription =
        Object.keys(description).length === 0
          ? productCardCore
          : { ...productCardCore, description };
      const productCardWithImage =
        featuredImage === undefined
          ? productCardWithDescription
          : { ...productCardWithDescription, featuredImage };
      const productCard =
        Object.keys(startingPrice).length === 0
          ? productCardWithImage
          : { ...productCardWithImage, regularStartingPrice, startingPrice };
      const productCore = {
        attributeFacets,
        availability,
        categories,
        category,
        objectID,
        priceAudienceIds: audienceIds,
        productCard,
        variants,
      };
      const productWithAttributes =
        record.attributes === undefined
          ? productCore
          : { ...productCore, attributes: record.attributes };
      return Object.keys(price).length === 0
        ? productWithAttributes
        : { ...productWithAttributes, price };
    }
  );
};

const configuredSecret = (
  helper: AlgoliaTransformationHelper | undefined,
  name: string
): string => {
  const value = helper?.secrets?.get?.(name);
  if (value === undefined) {
    throw new Error(`Missing Algolia transformation secret ${name}`);
  }
  return value;
};

const configuredObject = (
  value: unknown,
  label: string
): Readonly<Record<string, unknown>> => {
  if (!isConfiguredObject(value)) {
    throw new Error(`Invalid Algolia transformation ${label}`);
  }
  return value;
};

const configuredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Algolia transformation ${label}`);
  }
  return value;
};

const configuredArray = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`Invalid Algolia transformation ${label}`);
  }
  return value;
};

const configuredIds = (value: unknown, label: string): string[] =>
  configuredArray(value, label).map((candidate, index) =>
    configuredString(candidate, `${label}[${index}]`)
  );

const transformationConfiguration = (
  helper: AlgoliaTransformationHelper | undefined
): AlgoliaCommercetoolsTransformationConfiguration => {
  const encoded = configuredSecret(
    helper,
    ALGOLIA_COMMERCETOOLS_CONFIGURATION_SECRET_NAME
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch (error) {
    throw new Error("Invalid Algolia transformation configuration JSON", {
      cause: error,
    });
  }
  const configuration = configuredObject(decoded, "configuration");
  if (configuration.version !== ALGOLIA_COMMERCETOOLS_CONFIGURATION_VERSION) {
    throw new Error(
      `Unsupported Algolia transformation configuration version ${String(configuration.version)}`
    );
  }
  const priceCustomerGroupIds = configuredIds(
    configuration.priceCustomerGroupIds,
    "configuration.priceCustomerGroupIds"
  );
  const publicPriceChannelIds = configuredIds(
    configuration.publicPriceChannelIds,
    "configuration.publicPriceChannelIds"
  );
  const attributeFacets = configuredArray(
    configuration.attributeFacets,
    "configuration.attributeFacets"
  ).map((candidate): AlgoliaCommercetoolsAttributeFacet => {
    const attribute = configuredObject(candidate, "attribute facet");
    const facetType = attribute.type;
    if (
      (facetType !== "text" &&
        facetType !== "number" &&
        facetType !== "integer" &&
        facetType !== "boolean" &&
        facetType !== "enum" &&
        facetType !== "product-reference") ||
      typeof attribute.list !== "boolean"
    ) {
      throw new Error("Invalid Algolia attribute facet definition");
    }
    return {
      enumKeys: configuredIds(attribute.enumKeys, "attribute facet enum keys"),
      key: configuredString(attribute.key, "attribute facet key"),
      list: attribute.list,
      type: facetType,
    };
  });
  const defaultLocale = configuredString(
    configuration.defaultLocale,
    "configuration.defaultLocale"
  );
  if (
    publicPriceChannelIds.length > 1 ||
    new Set(priceCustomerGroupIds).size !== priceCustomerGroupIds.length ||
    priceCustomerGroupIds.some(
      (id) => id === publicAudience || id.startsWith("group:")
    )
  ) {
    throw new Error(
      "Ambiguous Algolia native pricing audience or public channel configuration"
    );
  }
  return {
    attributeFacets,
    defaultLocale,
    priceCustomerGroupIds,
    publicPriceChannelIds,
  };
};

// Algolia requires this global function name.
export async function transform(
  record: AlgoliaCommercetoolsRawProduct,
  helper?: AlgoliaTransformationHelper
): Promise<AlgoliaProductRecord[]> {
  return transformProduct(record, transformationConfiguration(helper));
}
