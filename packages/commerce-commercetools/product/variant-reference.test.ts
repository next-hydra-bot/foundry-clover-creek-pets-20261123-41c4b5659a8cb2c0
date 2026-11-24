import { VariantId } from "@repo/commerce-core/product/identity";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { resolveVariantReference, variantReference } from "./variant-reference";

describe("commercetools purchasable variant references", () => {
  it("identifies the product as well as its product-local variant number", () => {
    const first = variantReference("product-1", 3);
    const second = variantReference("product-2", 3);

    expect(first).toBe("ct:product-1:3");
    expect(second).toBe("ct:product-2:3");
    expect(Option.getOrThrow(resolveVariantReference(first))).toEqual({
      productId: "product-1",
      variantId: 3,
    });
    expect(Option.getOrThrow(resolveVariantReference(second))).toEqual({
      productId: "product-2",
      variantId: 3,
    });
  });

  it.each([
    "3",
    "gid://shopify/ProductVariant/3",
    "ct:product-1",
    "ct::3",
    "ct:product-1:",
    "ct:product-1:abc",
    "ct:product-1:01",
    "ct:product-1:1e2",
    ...[
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ].map((variantId) => `ct:product-1:${variantId}`),
  ])("rejects malformed or foreign reference %s", (reference) => {
    expect(resolveVariantReference(VariantId.make(reference))).toEqual(
      Option.none()
    );
  });
});
