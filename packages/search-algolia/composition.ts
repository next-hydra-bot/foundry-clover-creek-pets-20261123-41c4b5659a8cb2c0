import type { ContentSearchProjectionFactory } from "@repo/search/content-search-projection";

import { productStrategiesFromEnvironment } from "./product-provider";
import { createAlgoliaSearchProviderFromEnvironment } from "./provider";

export const createSearchProvider = (options: {
  readonly contentProjection: ContentSearchProjectionFactory;
}) => {
  const [provider] = [
    createAlgoliaSearchProviderFromEnvironment({
      ...options,

      additionalStrategies: productStrategiesFromEnvironment,
    }),
  ] as const;
  return provider;
};
