import type { ProductModel } from "@repo/commerce-core/catalog/product-model";
import type { FieldPath } from "@repo/commerce-core/product";
import { productAttributeFacets } from "@repo/search/product-attribute-discovery";
import type { ProductFacetFieldMapping } from "@repo/search/product-contract";

import { algoliaProductFieldPath } from "./connector/commercetools/generated-product";
import type {
  AlgoliaConnectorCurrency,
  AlgoliaConnectorLocale,
  AlgoliaProductFieldPath,
  AlgoliaProductRecord,
} from "./connector/commercetools/generated-product";

export type AlgoliaProductFacetFields<
  PhysicalFieldPath extends string = AlgoliaProductFieldPath,
> = ProductFacetFieldMapping<PhysicalFieldPath>;

export const defineAlgoliaProductFacetFields =
  <Document>() =>
  (
    fields: ProductFacetFieldMapping<FieldPath<Document>>
  ): ProductFacetFieldMapping<FieldPath<Document>> =>
    fields;

export const algoliaProductFacetFields = (
  locale: AlgoliaConnectorLocale,
  currency: AlgoliaConnectorCurrency,
  model?: ProductModel
): AlgoliaProductFacetFields =>
  defineAlgoliaProductFacetFields<AlgoliaProductRecord>()({
    availability: algoliaProductFieldPath("availability"),
    category: algoliaProductFieldPath(`category.${locale}`),
    price: algoliaProductFieldPath(`price.${currency}`),
    ...Object.fromEntries(
      productAttributeFacets(model).map(
        ({ attribute, id }) =>
          [
            id,
            algoliaProductFieldPath(
              `attributeFacets.${locale}.${attribute.key}`
            ),
          ] as const
      )
    ),
  });

export { algoliaProductFieldPath } from "./connector/commercetools/generated-product";
