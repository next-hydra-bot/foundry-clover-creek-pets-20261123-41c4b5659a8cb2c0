import type { NextConfig } from "next";

export function withCommerce(config: NextConfig): NextConfig {
  return {
    ...config,
    images: {
      ...config.images,
      remotePatterns: [
        ...(config.images?.remotePatterns ?? []),
        { hostname: "placehold.co", protocol: "https" },
        {
          hostname: "cdn.shopify.com",
          pathname: "/s/files/**",
          protocol: "https",
        },
        {
          hostname: "images.cdn.us-central1.gcp.commercetools.com",
          protocol: "https",
        },
        {
          hostname: "storage.googleapis.com",
          pathname: "/merchant-center-europe/sample-data/**",
          protocol: "https",
        },
      ],
    },
  };
}
