import { loadCatalogFile } from "@repo/commerce-core/catalog/files";
/* oxlint-disable anti-slop-effect/no-service-constructor-imports -- This CLI composition root assembles provider-owned Migrate destinations. */
import { prepareCustomerProfile } from "@repo/commerce-core/provisioning/pipeline";
import type {
  ProfilePreparation,
  ProvisioningCatalog,
  ProvisioningStore,
} from "@repo/commerce-core/provisioning/pipeline";
import { Config, ConfigProvider, Effect, Option } from "effect";
import { DestinationError } from "migrate-sdk";

import { makeCatalogDestination, makeCatalogSdk } from "../catalog/destination";
import { makeCatalogRegistry } from "../catalog/migrations";
import { createCommercetoolsApiRoot } from "../client/rest-client-live";
import { makeCustomerDestination } from "./customers";
import { makeIdentityLinkDestination } from "./identity-links";
import { withTaxSetup } from "./tax";

const fail = () =>
  new DestinationError({
    message:
      "Configure Commercetools project, catalog Store/channel IDs and provisioning credentials.",
  });
export const prepareTargets = (config: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const configured = yield* Config.all({
      distributionChannelId: Config.String(
        "COMMERCETOOLS_CATALOG_DISTRIBUTION_CHANNEL_ID"
      ),
      projectKey: Config.String("COMMERCETOOLS_PROJECT_KEY"),
      region: Config.String("COMMERCETOOLS_REGION"),
      storeKey: Config.String("COMMERCETOOLS_CATALOG_STORE_KEY"),
      supplyChannelId: Config.option(
        Config.String("COMMERCETOOLS_CATALOG_SUPPLY_CHANNEL_ID")
      ),
    }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, config));
    const target = {
      ...configured,
      supplyChannelId: Option.getOrUndefined(configured.supplyChannelId),
    };
    const catalogClient = yield* Effect.cached(
      Config.all({
        clientId: Config.String("COMMERCETOOLS_CLIENT_ID"),
        clientSecret: Config.Redacted("COMMERCETOOLS_CLIENT_SECRET"),
        scope: Config.String("COMMERCETOOLS_SCOPE"),
      }).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, config),
        Effect.map((credentials) => ({
          ...target,
          ...makeCatalogSdk(
            createCommercetoolsApiRoot(
              { ...target, ...credentials },
              { enableRetry: false }
            ),
            target.projectKey
          ),
        })),
        Effect.mapError(fail)
      )
    );
    const client = catalogClient.pipe(Effect.map(({ apiRoot }) => apiRoot));
    return {
      catalogClient,
      catalogDefinitions: (
        catalog: ProvisioningCatalog,
        store: ProvisioningStore
      ) => {
        const readers = {
          [catalog.files.catalogName]: () =>
            loadCatalogFile(catalog.catalogFile),
        };
        return makeCatalogRegistry({
          readers,
          destination: makeCatalogDestination(
            catalogClient,
            undefined,
            readers
          ),
          store,
        }).definitions();
      },
      client,
      customers: makeCustomerDestination(client),
      linkIdentity: makeIdentityLinkDestination(client),
      target: `commercetools:${JSON.stringify(target)}`,
    };
  }).pipe(Effect.mapError(fail));
export const prepareB2CProfile = (options: ProfilePreparation) =>
  Effect.gen(function* () {
    const base = yield* prepareTargets(options.config);
    const targets = yield* withTaxSetup(options, base, base.client);
    return yield* prepareCustomerProfile(options, targets);
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DestinationError
        ? cause
        : new DestinationError({
            message:
              "Invalid Commercetools B2C setup profile or target configuration.",
          })
    )
  );
