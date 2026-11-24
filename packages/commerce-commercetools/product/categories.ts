import { ProductCategoryDetail } from "@repo/commerce-core/product/category";
import type { CategorySlug } from "@repo/commerce-core/product/identity";
import type { CommerceLocale } from "@repo/commerce-core/store";
import { Effect, Schema } from "effect";

import type { CommercetoolsGraphQLClient } from "../client/graphql-client";
import { graphql } from "../graphql";
import type { ResultOf } from "../graphql";
import { CommercetoolsProductRequestFailure } from "./client";

export const categoriesQuery = graphql(`
  query CatalogCategories(
    $locale: Locale!
    $where: String
    $offset: Int!
    $limit: Int!
  ) {
    categories(
      where: $where
      sort: ["orderHint asc", "id asc"]
      offset: $offset
      limit: $limit
    ) {
      total
      results {
        id
        key
        name(locale: $locale)
        slug(locale: $locale)
        description(locale: $locale)
      }
    }
  }
`);

const decodeCategory = (
  category: ResultOf<typeof categoriesQuery>["categories"]["results"][number]
) =>
  Schema.decodeUnknownEffect(ProductCategoryDetail)({
    ...category,
    description: category.description ?? undefined,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CommercetoolsProductRequestFailure({
          cause,
          message: `Category ${category.id} requires a key, name and slug for the selected locale`,
        })
    )
  );

export const categoryClientMethods = (
  client: CommercetoolsGraphQLClient["Service"]
) => {
  const page = Effect.fn("Commercetools.categoryPage")(function* (
    locale: CommerceLocale,
    offset: number,
    limit: number,
    where?: string
  ) {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new CommercetoolsProductRequestFailure({
          cause,
          message: "Commercetools category request failed",
        }),
      try: async () =>
        await client.query(categoriesQuery, { locale, offset, limit, where }),
    });
    if (response.error || !response.data) {
      return yield* new CommercetoolsProductRequestFailure({
        cause: response.error,
        message: "Commercetools category response was unavailable",
      });
    }
    return response.data.categories;
  });
  return {
    findCategoryBySlug: Effect.fn("Commercetools.findCategoryBySlug")(
      function* ({
        locale,
        slug,
      }: {
        readonly locale: CommerceLocale;
        readonly slug: CategorySlug;
      }) {
        const { results } = yield* page(
          locale,
          0,
          1,
          `slug(${locale}=${JSON.stringify(slug)})`
        );
        const [category] = results;
        return category === undefined ? null : yield* decodeCategory(category);
      }
    ),
    listCategories: Effect.fn("Commercetools.listCategories")(function* (
      locale: CommerceLocale
    ) {
      const categories: ProductCategoryDetail[] = [];
      let offset = 0;
      while (true) {
        const { results, total } = yield* page(locale, offset, 500);
        categories.push(...(yield* Effect.forEach(decodeCategory)(results)));
        offset += results.length;
        if (offset >= total) {
          return categories;
        }
        if (results.length === 0 || offset > 10_000) {
          return yield* new CommercetoolsProductRequestFailure({
            message: "Commercetools category pagination could not continue",
          });
        }
      }
    }),
  };
};
