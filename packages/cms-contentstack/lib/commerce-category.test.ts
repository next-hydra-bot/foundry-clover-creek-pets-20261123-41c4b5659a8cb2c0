import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { decodeCommerceCategoryId } from "./commerce-category";

describe(decodeCommerceCategoryId, () => {
  it("preserves an absent Category selection", () => {
    const result = decodeCommerceCategoryId(undefined);

    expect(Option.isSome(result)).toBeTruthy();
    expect(Option.getOrUndefined(result)).toBeUndefined();
  });

  it("decodes a native text Category ID", () => {
    expect(
      Option.getOrUndefined(
        decodeCommerceCategoryId("gid://shopify/Collection/42")
      )
    ).toBe("gid://shopify/Collection/42");
  });

  it("decodes a selection from the custom field", () => {
    const result = decodeCommerceCategoryId({
      data: [{ id: "category-1", providerField: "ignored" }],
    });

    expect(Option.getOrUndefined(result)).toBe("category-1");
  });

  it("rejects malformed CMS Category data", () => {
    expect(
      Option.isNone(decodeCommerceCategoryId({ data: [{ id: "" }] }))
    ).toBeTruthy();
    expect(
      Option.isNone(decodeCommerceCategoryId({ data: "category-1" }))
    ).toBeTruthy();
  });
});
