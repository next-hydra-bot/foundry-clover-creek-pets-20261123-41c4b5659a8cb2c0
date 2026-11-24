import { OpenApi } from "effect/http-api";
import { describe, expect, it } from "vitest";

import { CommercetoolsCommerceHttpApi } from "./api";

describe("commercetools commerce OpenAPI", () => {
  it("documents anonymous access and the shared cart mutation paths", () => {
    const spec = OpenApi.fromApi(CommercetoolsCommerceHttpApi);
    expect(spec.paths["/cart"]?.get?.security).toContainEqual({});
    expect(Object.keys(spec.paths["/cart/items"] ?? {})).toEqual(
      expect.arrayContaining(["delete", "patch", "post"])
    );
    expect(spec.paths["/products"]?.get?.security).toContainEqual({});
  });

  it("requires bearer authentication for Order history", () => {
    const spec = OpenApi.fromApi(CommercetoolsCommerceHttpApi);
    expect(spec.paths["/orders"]?.get?.security).not.toContainEqual({});
    expect(
      Object.keys(spec.paths["/orders/{id}"]?.get?.responses ?? {})
    ).toEqual(
      expect.arrayContaining(["200", "400", "401", "403", "404", "503"])
    );
  });

  it("documents the storefront route prefix", () => {
    const spec = OpenApi.fromApi(
      CommercetoolsCommerceHttpApi.prefix("/api/commerce")
    );
    expect(Object.keys(spec.paths)).toEqual([
      "/api/commerce/cart",
      "/api/commerce/cart/items",
      "/api/commerce/cart/discount-codes",
      "/api/commerce/products",
      "/api/commerce/products/{slug}",
      "/api/commerce/orders",
      "/api/commerce/orders/{id}",
      "/api/commerce/address-book",
    ]);
  });
});
