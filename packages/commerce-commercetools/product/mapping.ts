import {
  ProductCard,
  ProductDetail,
  ProductTypeKey,
} from "@repo/commerce-core/product";
import {
  productAttributeSelections,
  productOptionsFromSelections,
} from "@repo/commerce-core/product/selection";
import type { CommerceLocale } from "@repo/commerce-core/store";
import { Effect, Schema } from "effect";

import { productAttributesReader } from "../product-attributes";
import type {
  CommercetoolsProductPrice,
  CommercetoolsProductProjection,
  CommercetoolsProductVariant,
} from "./client";
import { variantReference } from "./variant-reference";

type ProductTypeKeyValue = ProductTypeKey;
const productTypeName = (
  value: ProductTypeKey
): Parameters<typeof productAttributesReader.fromGraphql>[0] => value;

const mapPrice = (price: CommercetoolsProductPrice | null) => {
  if (price === null) {
    return undefined;
  }
  if (price.discounted === null) {
    return { regular: price.value };
  }
  return { discounted: price.discounted.value, regular: price.value };
};

const mapAvailability = (variant: CommercetoolsProductVariant) => {
  const availableQuantity = Math.max(
    0,
    variant.availability?.channels.reduce(
      (total, channel) => total + (channel.availableQuantity ?? 0),
      0
    ) ?? 0
  );
  return {
    availableForSale: availableQuantity > 0,
    availableQuantity,
  };
};

const mapImages = (variant: CommercetoolsProductVariant) =>
  variant.images.map(({ label, url }) =>
    label === null ? { url } : { altText: label, url }
  );

const mapVariant = (
  productId: string,
  productType: ProductTypeKeyValue,
  variant: CommercetoolsProductVariant,
  locale: CommerceLocale
) =>
  Effect.gen(function* () {
    const attributes = yield* productAttributesReader.fromGraphql(
      productTypeName(productType),
      variant.attributesRaw,
      { locale }
    ).read;
    const selections = productAttributeSelections(
      productType,
      attributes,
      undefined,
      locale
    );
    const mapped = {
      attributes,
      availability: mapAvailability(variant),
      id: variantReference(productId, variant.id),
      images: mapImages(variant),
      optionValues: Object.fromEntries(
        selections.map(({ key, value }) => [key, value.key])
      ),
      selections,
    };

    const mappedWithSku =
      variant.sku === null ? mapped : { ...mapped, sku: variant.sku };
    return variant.price === null
      ? mappedWithSku
      : { ...mappedWithSku, price: mapPrice(variant.price) };
  });

const mapCategory = (
  category: CommercetoolsProductProjection["categories"][number]
) => {
  const { id, name, slug } = category;
  if (name === null && slug === null) {
    return { id };
  }
  if (name === null) {
    return { id, slug };
  }
  if (slug === null) {
    return { id, name };
  }
  return { id, name, slug };
};

export const mapProductDetail = (
  product: CommercetoolsProductProjection,
  eligibleVariants: readonly CommercetoolsProductVariant[],
  locale: CommerceLocale
) =>
  Effect.gen(function* () {
    const productType = yield* Schema.decodeUnknownEffect(ProductTypeKey)(
      product.productType?.key
    );
    const variantsWithOptions = yield* Effect.forEach(
      (item: CommercetoolsProductVariant) =>
        mapVariant(product.id, productType, item, locale)
    )(eligibleVariants);
    const options = productOptionsFromSelections(
      variantsWithOptions.map(({ selections }) => selections)
    );
    const variants = variantsWithOptions.map(
      ({ selections: _selections, ...variant }) => variant
    );

    const detail = {
      categories: product.categories.map(mapCategory),
      defaultVariantId: variants[0]?.id,
      id: product.id,
      options,
      productType,
      slug: product.slug,
      title: product.name,
      variants,
    };
    const detailWithDescription =
      product.description === null
        ? detail
        : { ...detail, description: product.description };

    return yield* Schema.decodeUnknownEffect(ProductDetail)(
      detailWithDescription
    );
  });

export const mapProductCard = (
  product: CommercetoolsProductProjection,
  eligibleVariants: readonly CommercetoolsProductVariant[]
) => {
  const prices = eligibleVariants.flatMap(({ price }) =>
    price === null ? [] : [price]
  );
  let selectedPrice: (typeof prices)[number] | undefined;
  for (const price of prices) {
    const amount = price.discounted?.value ?? price.value;
    const current = selectedPrice?.discounted?.value ?? selectedPrice?.value;
    if (
      current === undefined ||
      amount.centAmount < current.centAmount ||
      (amount.centAmount === current.centAmount &&
        price.value.centAmount < (selectedPrice?.value.centAmount ?? Infinity))
    ) {
      selectedPrice = price;
    }
  }
  const startingPrice =
    selectedPrice?.discounted?.value ?? selectedPrice?.value;
  const [featuredImage] = product.masterVariant.images;
  const card = {
    availableForSale: eligibleVariants.some(
      (item) => mapAvailability(item).availableForSale
    ),
    id: product.id,
    slug: product.slug,
    title: product.name,
  };
  const cardWithDescription =
    product.description === null
      ? card
      : { ...card, description: product.description };
  let mappedFeaturedImage:
    | { readonly altText?: string; readonly url: string }
    | undefined;
  if (featuredImage !== undefined) {
    mappedFeaturedImage =
      featuredImage.label === null
        ? { url: featuredImage.url }
        : { altText: featuredImage.label, url: featuredImage.url };
  }
  const cardWithFeaturedImage =
    mappedFeaturedImage === undefined
      ? cardWithDescription
      : { ...cardWithDescription, featuredImage: mappedFeaturedImage };
  const completedCard =
    startingPrice === undefined
      ? cardWithFeaturedImage
      : {
          ...cardWithFeaturedImage,
          regularStartingPrice:
            selectedPrice &&
            selectedPrice.value.centAmount > startingPrice.centAmount
              ? selectedPrice.value
              : undefined,
          startingPrice,
        };

  return Schema.decodeUnknownEffect(ProductCard)(completedCard);
};
