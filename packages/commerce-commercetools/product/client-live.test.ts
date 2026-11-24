import { describe, expect, it } from "@effect/vitest";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AnonymousCommercePrincipal,
  AuthUserId,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import {
  CategoryId,
  ListProductCardsInput,
  ProductDiscovery,
  ProductSlug,
} from "@repo/commerce-core/product";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import {
  CommerceLocale,
  Store,
  StoreKey,
  resolveStore,
} from "@repo/commerce-core/store";
import { createRequest, getOperationName } from "@urql/core";
import { Effect, Layer } from "effect";
import { beforeEach, vi } from "vitest";

import { CommercetoolsGraphQLClient } from "../client/graphql-client";
import { CommercetoolsConfig } from "../config/config";
import { CommercetoolsProductDiscoveryClient } from "./client";
import { commercetoolsProductDiscoveryClientLayer } from "./client-live";
import { productDiscoveryLayerWithClient } from "./product-discovery";

const query = vi.fn();
const mutation = vi.fn();
let businessUnitGroups: string[] | null = null;
const queryWithCompanyAssignment: CommercetoolsGraphQLClient["Service"]["query"] =
  (document, variables) => {
    const name = getOperationName(createRequest(document, variables).query);
    if (name === "BusinessUnitPricingGroups") {
      return Promise.resolve({
        data: {
          businessUnit: {
            id: variables?.id,
            customerGroupAssignments:
              businessUnitGroups === null
                ? null
                : businessUnitGroups.map((id) => ({ customerGroup: { id } })),
          },
        },
      });
    }
    // oxlint-disable-next-line typescript/no-unsafe-return -- Preserve this file's existing scripted urql query fixture; only the new assignment operation is intercepted above.
    return query(document, variables);
  };
const graphqlClientLayer = CommercetoolsGraphQLClient.testLayer({
  mutation,
  query: queryWithCompanyAssignment,
});
const productClientLayer = commercetoolsProductDiscoveryClientLayer.pipe(
  Layer.provide(Layer.merge(graphqlClientLayer, CommercetoolsConfig.testLayer))
);

let store = resolveStore({ locale: CommerceLocale.make("en-US") });

const contextLayer = (authenticated: boolean) =>
  Layer.succeed(
    CommerceContext,
    CommerceContext.of({
      customerPrincipal: () => Effect.die("not used"),
      customerProfile: () => Effect.die("not used"),
      principal: authenticated
        ? new CustomerCommercePrincipal({
            authUserId: AuthUserId.make("auth-user-1"),
            businessUnitId: CommerceBusinessUnitId.make("business-unit-1"),
            businessUnitKey: CommerceBusinessUnitKey.make("business-unit-1"),
            customerId: CommerceCustomerId.make("customer-1"),
            roles: ["admin", "buyer"],
          })
        : new AnonymousCommercePrincipal({}),
      store,
    })
  );

const run = <A, E>(
  program: Effect.Effect<A, E, ProductDiscovery>,
  authenticated = false
) =>
  program.pipe(
    Effect.provide(
      productDiscoveryLayerWithClient(productClientLayer).pipe(
        Layer.provide(contextLayer(authenticated))
      )
    )
  );

const storeResponse = {
  data: {
    store: {
      id: "store-1",
      distributionChannels: [{ id: "distribution-channel-1", key: "sales" }],
      supplyChannels: [
        { id: "supply-channel-1", key: "stock-1" },
        { id: "supply-channel-2", key: "stock-2" },
      ],
    },
  },
};

let storeSequence = 0;
beforeEach(() => {
  store = new Store({
    ...store,
    storeKey: StoreKey.make(`catalog-test-${++storeSequence}`),
  });
  query.mockReset();
  businessUnitGroups = null;
});

describe("Commercetools Product Discovery GraphQL client", () => {
  it.effect(
    "translates a domain slug and Store into the exact Product Search query variables",
    () =>
      Effect.gen(function* () {
        query.mockResolvedValueOnce(storeResponse).mockResolvedValueOnce({
          data: { productsSearch: { results: [], total: 0 } },
        });

        yield* run(
          Effect.flatMap(ProductDiscovery, (service) =>
            service.findBySlug(ProductSlug.make("crawler-crane"))
          )
        );

        expect(query.mock.calls[1]?.[1]).toStrictEqual({
          currency: "USD",
          customerGroupId: undefined,
          customerGroupIds: undefined,
          distributionChannelId: "distribution-channel-1",
          query: {
            filter: [
              { exact: { field: "variants.stores", value: "store-1" } },
              {
                exact: {
                  caseInsensitive: false,
                  field: "slug",
                  language: "en-US",
                  value: "crawler-crane",
                },
              },
            ],
          },
          locale: "en-US",
          supplyChannelIds: ["supply-channel-1", "supply-channel-2"],
        });
      })
  );

  it.effect(
    "rejects ambiguous Store distribution channels before product discovery",
    () =>
      Effect.gen(function* () {
        query.mockResolvedValueOnce({
          data: {
            store: {
              distributionChannels: [{ id: "company-a" }, { id: "company-b" }],
              supplyChannels: [],
            },
          },
        });
        const outcome = yield* run(
          Effect.flatMap(ProductDiscovery, (service) =>
            service.findBySlug(ProductSlug.make("crawler-crane"))
          )
        ).pipe(Effect.exit);
        expect(outcome._tag).toBe("Failure");
        expect(query).toHaveBeenCalledOnce();
      })
  );

  it.effect(
    "uses the authenticated customer's group for buyer-segment price selection",
    () =>
      Effect.gen(function* () {
        query
          .mockResolvedValueOnce(storeResponse)
          .mockResolvedValueOnce({
            data: { customer: { customerGroup: { id: "customer-group-1" } } },
          })
          .mockResolvedValueOnce({
            data: { productsSearch: { results: [], total: 0 } },
          });

        yield* run(
          Effect.flatMap(ProductDiscovery, (service) =>
            service.findBySlug(ProductSlug.make("crawler-crane"))
          ),
          true
        );

        expect(query.mock.calls[1]?.[1]).toStrictEqual({
          customerId: "customer-1",
        });
        expect(query.mock.calls[2]?.[1]).toMatchObject({
          customerGroupId: "customer-group-1",
        });
      })
  );

  it.effect(
    "translates category and limit while fixing localized title ordering",
    () =>
      Effect.gen(function* () {
        query.mockResolvedValueOnce(storeResponse).mockResolvedValueOnce({
          data: { productsSearch: { results: [], total: 0 } },
        });

        yield* run(
          Effect.flatMap(ProductDiscovery, (service) =>
            service.listCards(
              new ListProductCardsInput({
                categoryId: CategoryId.make("category-1"),
                limit: 3,
              })
            )
          )
        );

        expect(query.mock.calls[1]?.[1]).toMatchObject({
          query: {
            filter: [
              { exact: { field: "variants.stores", value: "store-1" } },
              { exact: { field: "categories", value: "category-1" } },
            ],
          },
          sort: [
            { field: "name", language: "en-US", order: "asc" },
            { field: "id", order: "asc" },
          ],
          limit: 3,
        });
      })
  );

  it.effect("omits the category filter when no category is selected", () =>
    Effect.gen(function* () {
      query.mockResolvedValueOnce(storeResponse).mockResolvedValueOnce({
        data: { productsSearch: { results: [], total: 0 } },
      });

      yield* run(
        Effect.flatMap(ProductDiscovery, (service) =>
          service.listCards(
            new ListProductCardsInput({
              limit: 3,
            })
          )
        )
      );

      expect(query.mock.calls[1]?.[1]).toMatchObject({
        query: { exact: { field: "variants.stores", value: "store-1" } },
        limit: 3,
      });
    })
  );

  it.effect("maps a GraphQL response error to ProductDiscoveryFailure", () =>
    Effect.gen(function* () {
      const graphqlFailure = new Error("GraphQL unavailable");
      query
        .mockResolvedValueOnce(storeResponse)
        .mockResolvedValueOnce({ error: graphqlFailure });

      const failure = yield* run(
        Effect.flatMap(ProductDiscovery, (service) =>
          service
            .findBySlug(ProductSlug.make("crawler-crane"))
            .pipe(Effect.flip)
        )
      );

      expect(failure).toMatchObject({
        _tag: "ProductDiscoveryFailure",
        operation: "findBySlug",
      });
    })
  );
});

it.effect(
  "resolves native Business Unit groups independently of the employee group",
  () =>
    Effect.gen(function* () {
      businessUnitGroups = ["company-group"];
      query.mockResolvedValueOnce({
        data: {
          store: {
            id: "company-store",
            distributionChannels: [{ id: "sales", key: "sales" }],
            supplyChannels: [],
          },
        },
      });
      const context = yield* CommercetoolsProductDiscoveryClient.pipe(
        Effect.flatMap((client) =>
          client.resolveProductContext({
            storeKey: store.storeKey,
            locale: store.locale,
            currency: store.currency,
            customerId: CommerceCustomerId.make("employee"),
            businessUnitId: CommerceBusinessUnitId.make("company"),
          })
        ),
        Effect.provide(productClientLayer)
      );
      expect(context.customerGroupIds).toEqual(["company-group"]);
      expect(context.customerGroupId).toBeUndefined();
      expect(query).toHaveBeenCalledOnce();
    })
);

it.effect(
  "keeps an empty Business Unit assignment distinct from customer inheritance",
  () =>
    Effect.gen(function* () {
      businessUnitGroups = [];
      query
        .mockResolvedValueOnce(storeResponse)
        .mockResolvedValueOnce({ data: { productsSearch: { results: [] } } });
      yield* run(
        Effect.flatMap(ProductDiscovery, (service) =>
          service.findBySlug(ProductSlug.make("machine"))
        ),
        true
      );
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1]?.[1]).toMatchObject({
        customerGroupIds: [],
        customerGroupId: undefined,
      });
    })
);

it.effect(
  "passes all native Business Unit groups to product price selection",
  () =>
    Effect.gen(function* () {
      businessUnitGroups = ["gold-id", "regional-id", "gold-id"];
      query
        .mockResolvedValueOnce(storeResponse)
        .mockResolvedValueOnce({ data: { productsSearch: { results: [] } } });
      yield* run(
        Effect.flatMap(ProductDiscovery, (service) =>
          service.findBySlug(ProductSlug.make("machine"))
        ),
        true
      );
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1]?.[1]).toMatchObject({
        customerGroupIds: ["gold-id", "regional-id"],
        customerGroupId: undefined,
      });
    })
);
