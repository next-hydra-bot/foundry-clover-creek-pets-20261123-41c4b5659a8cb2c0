import { describe, expect, it } from "@effect/vitest";
import { CategorySlug } from "@repo/commerce-core/product/identity";
import { CommerceLocale } from "@repo/commerce-core/store";
import { createClient, fetchExchange } from "@urql/core";
import { Effect } from "effect";
import { vi } from "vitest";

import { categoryClientMethods } from "./categories";

const category = {
  description: "Sacs pour la journée",
  id: "category-1",
  key: "outdoor-packs",
  name: "Sacs",
  slug: "sacs",
};
const locale = CommerceLocale.make("fr-FR");
const categoryClient = (fetch: typeof globalThis.fetch) =>
  categoryClientMethods(
    createClient({
      exchanges: [fetchExchange],
      fetch,
      preferGetMethod: false,
      requestPolicy: "network-only",
      url: "https://example.test/graphql",
    })
  );
const response = (
  results: readonly (
    | typeof category
    | (Omit<typeof category, "key"> & { readonly key: null })
  )[],
  total: number
) => Response.json({ data: { categories: { results, total } } });

describe("Commercetools categories", () => {
  it.effect(
    "queries the localized slug and retains the stable native key",
    () =>
      Effect.gen(function* () {
        const fetch = vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response([category], 1));
        const client = categoryClient(fetch);
        expect(
          yield* client.findCategoryBySlug({
            locale,
            slug: CategorySlug.make("sacs"),
          })
        ).toEqual(category);
        expect(fetch.mock.calls[0]?.[1]?.body).toContain(
          '"where":"slug(fr-FR=\\"sacs\\")"'
        );
        expect(fetch.mock.calls[0]?.[1]?.body).toContain('"locale":"fr-FR"');
      })
  );

  it.effect("returns null for a missing localized category", () =>
    Effect.gen(function* () {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response([], 0));
      expect(
        yield* categoryClient(fetch).findCategoryBySlug({
          locale,
          slug: CategorySlug.make("missing"),
        })
      ).toBeNull();
    })
  );

  it.effect("paginates categories without dropping later pages", () =>
    Effect.gen(function* () {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response([category], 2))
        .mockResolvedValueOnce(
          response(
            [
              {
                ...category,
                id: "category-2",
                key: "outdoor-clothing",
                slug: "vestes",
              },
            ],
            2
          )
        );
      expect(
        (yield* categoryClient(fetch).listCategories(locale)).map(
          ({ key }) => key
        )
      ).toEqual(["outdoor-packs", "outdoor-clothing"]);
      expect(fetch.mock.calls[1]?.[1]?.body).toContain('"offset":1');
    })
  );

  it.effect(
    "reports a category without an indexable key as a configuration failure",
    () =>
      Effect.gen(function* () {
        const fetch = vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response([{ ...category, key: null }], 1));
        const result = yield* categoryClient(fetch)
          .findCategoryBySlug({ locale, slug: CategorySlug.make("sacs") })
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure.message).toContain(
            "requires a key, name and slug"
          );
        }
      })
  );
});
