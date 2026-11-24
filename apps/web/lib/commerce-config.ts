import type { NextConfig } from "next";

export function withCommerceRuntime(config: NextConfig): NextConfig {
  return {
    ...config,
    turbopack: {
      ...config.turbopack,
      resolveAlias: {
        ...config.turbopack?.resolveAlias,
        "@repo/commerce-core/bindings": "./lib/commerce-runtime.ts",
        "@repo/commerce-checkout/bindings": "./lib/commerce-runtime.ts",
        "@repo/commerce-b2c/bindings": "./lib/commerce-runtime.ts",
      },
    },
  };
}
