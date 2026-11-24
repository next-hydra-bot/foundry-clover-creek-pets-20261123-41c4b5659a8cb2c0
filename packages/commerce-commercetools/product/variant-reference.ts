import { ProductId, VariantId } from "@repo/commerce-core/product/identity";
import { Option, Schema } from "effect";

const referenceSchema = Schema.Struct({
  productId: ProductId,
  variantId: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  ),
});

/** Native variant numbers are only unique within their product. */
export const variantReference = (
  productId: string,
  variantId: number
): VariantId => {
  const reference = Schema.decodeSync(referenceSchema)({
    productId,
    variantId,
  });
  return VariantId.make(`ct:${reference.productId}:${reference.variantId}`);
};

/** Only this provider interprets the public purchasable reference. */
export const resolveVariantReference = (reference: VariantId) => {
  const match = /^ct:(?<productId>.+):(?<variantId>[1-9]\d*)$/su.exec(
    reference
  );
  return match
    ? Schema.decodeUnknownOption(referenceSchema)({
        productId: match.groups?.productId,
        variantId: Number(match.groups?.variantId),
      })
    : Option.none<typeof referenceSchema.Type>();
};
