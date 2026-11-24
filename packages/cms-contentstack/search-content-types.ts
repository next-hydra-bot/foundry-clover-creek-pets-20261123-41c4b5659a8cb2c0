import { articleSearchType } from "./recipe/search/article";
import { landingPageSearchType } from "./recipe/search/landing-page.ts";
import { productCollectionSearchInstructions } from "./recipe/search/product-collection.ts";
import { resolveSearchContentTypes } from "./recipe/search/types.ts";

const contributions = {
  landingPageSearchType,
  articleSearchType,
  productCollectionSearchInstructions,
};

export const searchableContentTypes = resolveSearchContentTypes(
  Object.values(contributions)
);
