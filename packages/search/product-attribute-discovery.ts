import {
  modelLabel,
  productModel,
} from "@repo/commerce-core/catalog/product-model";
import type {
  ProductAttributeDefinition,
  ProductModel,
} from "@repo/commerce-core/catalog/product-model";

const mergeLabels = (
  key: string,
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
) => {
  for (const [locale, label] of Object.entries(right)) {
    if (left[locale] !== undefined && left[locale] !== label) {
      throw new Error(
        `Search attribute ${key} has conflicting labels for ${locale}; use distinct keys`
      );
    }
  }
  return { ...left, ...right };
};

/** All indexed attributes, independently of the storefront's visible facet selection. */
export const productAttributeFacets = (model: ProductModel = productModel) => {
  const attributes = new Map<string, ProductAttributeDefinition>();
  for (const type of model.productTypes) {
    for (const attribute of type.attributes) {
      const existing = attributes.get(attribute.key);
      if (
        existing &&
        (existing.type !== attribute.type ||
          !!existing.list !== !!attribute.list)
      ) {
        throw new Error(
          `Search attribute ${attribute.key} has incompatible definitions; use distinct keys`
        );
      }
      if (!existing) {
        attributes.set(attribute.key, attribute);
        continue;
      }
      const values = new Map(
        existing.values?.map((value) => [value.key, value])
      );
      for (const value of attribute.values ?? []) {
        values.set(value.key, {
          key: value.key,
          labels: mergeLabels(
            `${attribute.key}/${value.key}`,
            values.get(value.key)?.labels ?? {},
            value.labels
          ),
        });
      }
      const [first, ...rest] = values.values();
      const merged = {
        ...attribute,
        labels: mergeLabels(attribute.key, existing.labels, attribute.labels),
      };
      attributes.set(
        attribute.key,
        first === undefined ? merged : { ...merged, values: [first, ...rest] }
      );
    }
  }
  return [...attributes.values()].map((attribute) => {
    const common = {
      attribute,
      id: `attribute.${attribute.key}` as const,
      route: `attribute.${attribute.key}` as const,
    };
    return attribute.type === "number" || attribute.type === "integer"
      ? { ...common, control: "range" as const }
      : {
          ...common,
          control: "refinement-list" as const,
          facetValueSearch: true,
        };
  });
};

/** Combine declared facets in Product Type order, keeping each shared key once. */
export const productSearchFacets = (model: ProductModel = productModel) => {
  const attributes = new Map(
    productAttributeFacets(model).map((facet) => [facet.attribute.key, facet])
  );
  const keys = new Set(
    model.productTypes.flatMap((type) => type.searchFacets ?? [])
  );
  return [...keys].map((key) => {
    const facet = attributes.get(key);
    if (facet === undefined || facet.attribute.type === "product-reference") {
      throw new Error(`Invalid search facet: ${key}`);
    }
    return facet;
  });
};

export const attributeFacetLabel = (id: string, locale: string) => {
  const facet = productAttributeFacets().find((facet) => facet.id === id);
  return facet
    ? modelLabel(facet.attribute.labels, locale, productModel.defaultLocale)
    : undefined;
};

export const attributeFacetValueLabel = (
  id: string,
  value: string,
  locale: string
) => {
  const attribute = productAttributeFacets().find(
    (facet) => facet.id === id
  )?.attribute;
  const selected = attribute?.values?.find(({ key }) => key === value);
  return selected
    ? modelLabel(selected.labels, locale, productModel.defaultLocale)
    : value;
};
