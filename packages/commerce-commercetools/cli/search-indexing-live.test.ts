import { ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createCommercetoolsSearchIndexingSource } from "./search-indexing-live";

const searchConfig = Effect.succeed(
  ConfigProvider.fromUnknown({
    CTP_API_URL: "https://api.us-central1.gcp.commercetools.com",
    CTP_AUTH_URL: "https://auth.us-central1.gcp.commercetools.com",
    CTP_CLIENT_ID: "client",
    CTP_CLIENT_SECRET: "secret",
    CTP_PROJECT_KEY: "project",
    CTP_SCOPES: "view_stores:project view_customer_groups:project",
  })
);

describe(createCommercetoolsSearchIndexingSource, () => {
  it("preserves the typed commerce indexing failure at the search-provider seam", async () => {
    const source = await createCommercetoolsSearchIndexingSource(
      Effect.succeed(
        ConfigProvider.fromUnknown({
          CTP_API_URL: "https://api.us-central1.gcp.commercetools.com",
          CTP_AUTH_URL: "https://auth.us-central1.gcp.commercetools.com",
          CTP_CLIENT_ID: "bootstrap-client-id",
          CTP_CLIENT_SECRET: "bootstrap-client-secret",
          CTP_PROJECT_KEY: "project-key",
          CTP_SCOPES: "view_products:project-key",
        })
      )
    ).pipe(Effect.runPromise);

    const error = await source
      .reconcileManagedApiClient({
        name: "Managed Algolia connector (acceptance)",
        scopeNames: ["view_products"],
      })
      .pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "CommerceSearchIndexingFailure",
      operation: "reconcileManagedApiClient",
    });
  });

  it("reuses the authenticated managed client without deleting other same-name clients", async () => {
    const requests: { readonly method: string; readonly url: string }[] = [];
    const httpClient = vi.fn<typeof fetch>(async (input, init) => {
      await Promise.resolve();
      let url: string;
      if (input instanceof Request) {
        ({ url } = input);
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input;
      }
      const method = init?.method ?? "GET";
      requests.push({ method, url });

      if (
        url === "https://auth.us-central1.gcp.commercetools.com/oauth/token"
      ) {
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (method === "GET" && url.includes("/project-key/api-clients")) {
        return Response.json({
          count: 2,
          limit: 500,
          offset: 0,
          results: [
            {
              id: "current-client-id",
              name: "Managed Algolia connector (acceptance)",
              scope: "view_stores:project-key view_products:project-key",
            },
            {
              id: "other-application-client-id",
              name: "Managed Algolia connector (acceptance)",
              scope: "view_products:project-key",
            },
          ],
          total: 2,
        });
      }
      throw new Error(`Unexpected commercetools request ${method} ${url}`);
    });
    const configProvider = Effect.succeed(
      ConfigProvider.fromUnknown({
        CTP_API_URL: "https://api.us-central1.gcp.commercetools.com",
        CTP_AUTH_URL: "https://auth.us-central1.gcp.commercetools.com",
        CTP_CLIENT_ID: "bootstrap-client-id",
        CTP_CLIENT_SECRET: "bootstrap-client-secret",
        CTP_PROJECT_KEY: "project-key",
        CTP_SCOPES: "manage_api_clients:project-key",
      })
    );
    const source = await createCommercetoolsSearchIndexingSource(
      configProvider,
      { httpClient }
    ).pipe(Effect.runPromise);

    const managedClient = await source
      .reconcileManagedApiClient({
        existingClientId: "current-client-id",
        existingScope: "view_stores:project-key view_products:project-key",
        name: "Managed Algolia connector (acceptance)",
        scopeNames: ["view_products", "view_stores"],
      })
      .pipe(Effect.runPromise);

    expect(managedClient).toEqual({
      clientId: "current-client-id",
      scope: "view_products:project-key view_stores:project-key",
      status: "current",
    });
    expect(requests.some(({ method }) => method === "DELETE")).toBeFalsy();
    expect(
      requests.some(
        ({ method, url }) =>
          method === "POST" && url.includes("/project-key/api-clients")
      )
    ).toBeFalsy();
  });

  it("creates replacement credentials when the authenticated client scope is stale", async () => {
    const requests: { readonly method: string; readonly url: string }[] = [];
    const httpClient = vi.fn<typeof fetch>(async (input, init) => {
      await Promise.resolve();
      let url: string;
      if (input instanceof Request) {
        ({ url } = input);
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input;
      }
      const method = init?.method ?? "GET";
      requests.push({ method, url });

      if (
        url === "https://auth.us-central1.gcp.commercetools.com/oauth/token"
      ) {
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (method === "GET" && url.includes("/project-key/api-clients")) {
        return Response.json({
          count: 1,
          limit: 500,
          offset: 0,
          results: [
            {
              id: "current-client-id",
              name: "Managed Algolia connector (acceptance)",
              scope: "view_products:project-key",
            },
          ],
          total: 1,
        });
      }
      if (method === "POST" && url.endsWith("/project-key/api-clients")) {
        return Response.json({
          id: "replacement-client-id",
          name: "Managed Algolia connector (acceptance)",
          scope: "view_products:project-key view_stores:project-key",
          secret: "replacement-client-secret",
        });
      }
      throw new Error(`Unexpected commercetools request ${method} ${url}`);
    });
    const configProvider = Effect.succeed(
      ConfigProvider.fromUnknown({
        CTP_API_URL: "https://api.us-central1.gcp.commercetools.com",
        CTP_AUTH_URL: "https://auth.us-central1.gcp.commercetools.com",
        CTP_CLIENT_ID: "bootstrap-client-id",
        CTP_CLIENT_SECRET: "bootstrap-client-secret",
        CTP_PROJECT_KEY: "project-key",
        CTP_SCOPES: "manage_api_clients:project-key",
      })
    );
    const source = await createCommercetoolsSearchIndexingSource(
      configProvider,
      { httpClient }
    ).pipe(Effect.runPromise);

    const managedClient = await source
      .reconcileManagedApiClient({
        existingClientId: "current-client-id",
        existingScope: "view_products:project-key",
        name: "Managed Algolia connector (acceptance)",
        scopeNames: ["view_products", "view_stores"],
      })
      .pipe(Effect.runPromise);

    expect({
      ...managedClient,
      clientSecret:
        managedClient.status === "created"
          ? Redacted.value(managedClient.clientSecret)
          : undefined,
    }).toEqual({
      clientId: "replacement-client-id",
      clientSecret: "replacement-client-secret",
      replacedClientId: "current-client-id",
      scope: "view_products:project-key view_stores:project-key",
      status: "created",
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        {
          method: "POST",
          url: "https://api.us-central1.gcp.commercetools.com/project-key/api-clients",
        },
      ])
    );
  });

  it("resolves Store channels and validates the configured native Customer Groups", async () => {
    let wrongIdentity = false;
    // oxlint-disable-next-line require-await -- Fetch-compatible fixture uses deterministic in-memory responses.
    const httpClient: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.includes("/oauth/token")) {
        return Response.json({
          access_token: "test",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (request.url.includes("/stores/key=equipment")) {
        return Response.json({
          id: "store-1",
          key: "equipment",
          distributionChannels: [{ typeId: "channel", id: "sales" }],
        });
      }
      if (request.url.includes("/customer-groups/")) {
        return Response.json({
          id: wrongIdentity ? "wrong-id" : request.url.split("/").at(-1),
        });
      }
      throw new Error(`Unexpected request ${request.url}`);
    };
    const source = await Effect.runPromise(
      createCommercetoolsSearchIndexingSource(searchConfig, { httpClient })
    );
    const context = await Effect.runPromise(
      source.resolveContext({
        storeKeys: ["equipment"],
        priceCustomerGroupIds: ["gold-id", "standard-id"],
      })
    );
    expect({
      groups: context.priceCustomerGroupIds,
      stores: context.stores,
    }).toEqual({
      groups: ["gold-id", "standard-id"],
      stores: [{ storeKey: "equipment", publicPriceChannelIds: ["sales"] }],
    });
    wrongIdentity = true;
    const error = await Effect.runPromise(
      source
        .resolveContext({
          storeKeys: ["equipment"],
          priceCustomerGroupIds: ["gold-id"],
        })
        .pipe(Effect.flip)
    );
    expect(String(error.cause)).toContain("Configured pricing Customer Group");
  });
});
