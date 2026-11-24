import type {
  AttributeDefinition,
  AttributeType,
  ProductTypeDraft,
} from "@commercetools/platform-sdk";
import {
  productModel,
  modelLabel,
} from "@repo/commerce-core/catalog/product-model";
import type {
  ProductAttributeDefinition,
  ProductModel,
} from "@repo/commerce-core/catalog/product-model";

const nativeType = (
  attribute: ProductAttributeDefinition,
  model: ProductModel
): AttributeType => {
  let scalar: AttributeType;
  switch (attribute.type) {
    case "integer":
    case "number": {
      scalar = { name: "number" };
      break;
    }
    case "text": {
      scalar = { name: "text" };
      break;
    }
    case "boolean": {
      scalar = { name: "boolean" };
      break;
    }
    case "product-reference": {
      scalar = { name: "reference", referenceTypeId: "product" };
      break;
    }
    case "enum": {
      const localized = attribute.values?.some(
        ({ labels }) => new Set(Object.values(labels)).size > 1
      );
      scalar = localized
        ? {
            name: "lenum",
            values: (attribute.values ?? []).map(({ key, labels }) => ({
              key,
              label: { ...labels },
            })),
          }
        : {
            name: "enum",
            values: (attribute.values ?? []).map(({ key, labels }) => ({
              key,
              label: modelLabel(labels, model.defaultLocale),
            })),
          };
      break;
    }
    default: {
      throw new Error("Unsupported attribute type");
    }
  }
  return attribute.list ? { elementType: scalar, name: "set" } : scalar;
};
export const productTypeDrafts = (
  model: ProductModel
): readonly (ProductTypeDraft & {
  readonly attributes: AttributeDefinition[];
  readonly key: string;
})[] =>
  model.productTypes.map((type) => ({
    attributes: type.attributes.map(
      (attribute): AttributeDefinition => ({
        attributeConstraint:
          attribute.variantConstraint === undefined
            ? "None"
            : (
                {
                  same: "SameForAll",
                  unique: "Unique",
                  combination: "CombinationUnique",
                } as const
              )[attribute.variantConstraint],
        inputHint: "SingleLine",
        isRequired:
          attribute.required && attribute.type !== "product-reference",
        isSearchable: attribute.type !== "product-reference",
        label: { ...attribute.labels },
        level: "Variant",
        name: attribute.key,
        type: nativeType(attribute, model),
      })
    ),
    description: type.description,
    key: type.key,
    name: modelLabel(type.labels, model.defaultLocale),
  }));
export const productTypes = productTypeDrafts(productModel);
