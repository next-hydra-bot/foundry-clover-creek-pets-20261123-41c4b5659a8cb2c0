import {
  ProductDiscovery,
  ProductDiscoveryFailure,
} from "@repo/commerce-core/product";
import type { ProductCard, ProductDetail } from "@repo/commerce-core/product";
import { toProductVariantCards } from "@repo/commerce-core/product/variant-cards";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer, Option } from "effect";

import { CommercetoolsProductDiscoveryClient } from "./client";
import { mapProductCard, mapProductDetail } from "./mapping";
import { resolveVariantReference } from "./variant-reference";

const productDiscoveryImplementationLayer = Layer.effect(
  ProductDiscovery,
  Effect.gen(function* () {
    const commerceContext = yield* CommerceContext;
    const client = yield* CommercetoolsProductDiscoveryClient;

    const resolveProductContext = client.resolveProductContext({
      businessUnitId:
        commerceContext.principal._tag === "CustomerCommercePrincipal"
          ? commerceContext.principal.businessUnitId
          : undefined,
      currency: commerceContext.store.currency,
      customerId:
        commerceContext.principal._tag === "AnonymousCommercePrincipal"
          ? undefined
          : commerceContext.principal.customerId,
      locale: commerceContext.store.locale,
      storeKey: commerceContext.store.storeKey,
    });

    return ProductDiscovery.of({
      findVariantCards: Effect.fn("ProductDiscovery.findVariantCards")(
        function* (ids) {
          if (ids.length === 0) return [];
          const requested = new Set(ids);
          const productIds = [
            ...new Set(
              ids.flatMap((id) => {
                const reference = resolveVariantReference(id);
                return Option.isSome(reference)
                  ? [reference.value.productId]
                  : [];
              })
            ),
          ];
          if (productIds.length === 0) return [];
          const context = yield* resolveProductContext;
          const products = yield* client.listProductProjections({
            context,
            currency: commerceContext.store.currency,
            locale: commerceContext.store.locale,
            limit: productIds.length,
            productIds,
          });
          const cards = yield* Effect.forEach(products, (product) =>
            product.allVariants.length === 0
              ? Effect.succeed([])
              : mapProductDetail(
                  product,
                  product.allVariants,
                  commerceContext.store.locale
                ).pipe(Effect.map(toProductVariantCards))
          );
          return cards.flat().filter((card) => requested.has(card.id));
        },
        Effect.mapError(
          (cause) =>
            new ProductDiscoveryFailure({
              cause,
              message: "Commercetools saved Product lookup failed",
              operation: "findVariantCards",
            })
        )
      ),
      findCategoryBySlug: (slug) =>
        client
          .findCategoryBySlug({ locale: commerceContext.store.locale, slug })
          .pipe(
            Effect.map(Option.fromNullishOr),
            Effect.mapError(
              (cause) =>
                new ProductDiscoveryFailure({
                  cause,
                  message: "Commercetools category lookup failed",
                  operation: "findCategoryBySlug",
                })
            )
          ),
      listCategories: () =>
        client.listCategories(commerceContext.store.locale).pipe(
          Effect.mapError(
            (cause) =>
              new ProductDiscoveryFailure({
                cause,
                message: "Commercetools category listing failed",
                operation: "listCategories",
              })
          )
        ),
      findBySlug: Effect.fn("ProductDiscovery.findBySlug")((slug) =>
        Effect.gen(function* () {
          const context = yield* resolveProductContext;
          const product = yield* client.findProductBySlug({
            context,
            currency: commerceContext.store.currency,
            locale: commerceContext.store.locale,
            slug,
          });

          if (product === null) {
            return Option.none<ProductDetail>();
          }
          const eligibleVariants = product.allVariants;
          if (eligibleVariants.length === 0) {
            return Option.none<ProductDetail>();
          }

          return Option.some(
            yield* mapProductDetail(
              product,
              eligibleVariants,
              commerceContext.store.locale
            )
          );
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProductDiscoveryFailure({
                cause,
                message: "Commercetools Product detail discovery failed",
                operation: "findBySlug",
              })
          )
        )
      ),
      listCards: Effect.fn("ProductDiscovery.listCards")((input) =>
        Effect.gen(function* () {
          const context = yield* resolveProductContext;
          const listInput = {
            context,
            currency: commerceContext.store.currency,
            limit: input.limit,
            locale: commerceContext.store.locale,
          };
          const products = yield* client.listProductProjections(
            input.categoryId === undefined
              ? listInput
              : { ...listInput, categoryId: input.categoryId }
          );
          const includedProducts = products.filter(
            ({ id }) => id !== input.excludeProductId
          );
          const cards: ProductCard[] = [];

          for (const product of includedProducts) {
            const eligibleVariants = product.allVariants;
            if (eligibleVariants.length === 0) {
              continue;
            }
            const result = yield* mapProductCard(
              product,
              eligibleVariants
            ).pipe(Effect.result);
            if (result._tag === "Success") {
              cards.push(result.success);
            } else {
              yield* Effect.logWarning(
                "Omitting malformed Commercetools Product Card",
                { cause: result.failure, productId: product.id }
              );
            }
          }

          return (
            cards
              // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; cards is a fresh local array.
              .sort((left, right) =>
                left.title.localeCompare(
                  right.title,
                  commerceContext.store.locale
                )
              )
              .slice(0, input.limit)
          );
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProductDiscoveryFailure({
                cause,
                message: "Commercetools Product card discovery failed",
                operation: "listCards",
              })
          )
        )
      ),
      searchAudience: Effect.fn("ProductDiscovery.searchAudience")(() =>
        resolveProductContext.pipe(
          Effect.flatMap((context) => {
            if (context.customerGroupIds !== undefined) {
              if (context.customerGroupIds.length > 1) {
                return Effect.fail(
                  new ProductDiscoveryFailure({
                    operation: "searchAudience",
                    message:
                      "Company search requires one pricing Customer Group; multiple native assignments need a combined search audience",
                  })
                );
              }
              return Effect.succeed({
                priceAudienceIds: context.customerGroupIds.map(
                  (id) => `group:${id}`
                ),
              });
            }
            return Effect.succeed({
              priceAudienceIds:
                context.customerGroupId === undefined
                  ? []
                  : [`group:${context.customerGroupId}`],
            });
          }),
          Effect.mapError((cause) =>
            cause._tag === "ProductDiscoveryFailure"
              ? cause
              : new ProductDiscoveryFailure({
                  cause,
                  message: "Commercetools Product search audience failed",
                  operation: "searchAudience",
                })
          )
        )
      ),
    });
  })
);

export const productDiscoveryLayerWithClient = <E, R>(
  clientLayer: Layer.Layer<CommercetoolsProductDiscoveryClient, E, R>
) => productDiscoveryImplementationLayer.pipe(Layer.provide(clientLayer));
